import { useEffect, useState } from 'preact/hooks';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SyncEngine } from '../core/sync';
import type { SyncingStore } from '../storage/outbox';

import project from '../../supabase/project.json';

/**
 * Supabase-Projekt der App. Der anon key ist dafür gedacht, öffentlich in der App zu stehen; geschützt
 * wird über die Regeln in der Datenbank. Zum lokalen Testen lässt er sich per VITE_SUPABASE_* ersetzen.
 */
const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || project.url;
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || project.anonKey;

/**
 * Mit Supabase-Projekt ist die Anmeldung Pflicht und der Server die Quelle der Wahrheit. Ohne Projekt
 * (supabase/project.json leer) arbeitet die App wie früher nur im Browser.
 */
export const cloudConfigured = !!(URL && KEY);

export type CloudStatus = 'off' | 'loading' | 'signed-out' | 'code-sent' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudState {
  status: CloudStatus;
  /** Angemeldet (beim Code-Versand steht die E-Mail schon fest, angemeldet ist man erst danach). */
  signedIn: boolean;
  email?: string;
  /** Letzter erfolgreicher Abgleich (ISO). */
  lastSync?: string;
  /** Änderungen, die noch nicht auf dem Server sind. */
  pending: number;
  message?: string;
}

/** Wartezeit nach einer Änderung, damit schnelle Scans gesammelt gesendet werden. */
const DEBOUNCE_MS = 2000;
const LAST_SYNC_KEY = 'cardscanner.lastSync';

/**
 * Konto und Abgleich mit dem Server. Die Sammlung liegt auf dem Server; der Browser hält eine Kopie,
 * damit Scannen und Ansehen auch offline gehen. Änderungen warten dann in der Warteschlange.
 */
class Cloud {
  state: CloudState = { status: cloudConfigured ? 'loading' : 'off', signedIn: false, pending: 0, lastSync: readLastSync() };
  private listeners = new Set<(s: CloudState) => void>();
  private client: Promise<SupabaseClient> | null = null;
  private store: SyncingStore | null = null;
  private engine: SyncEngine | null = null;
  private onRemoteChange: () => void = () => {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private again = false;

  subscribe(fn: (s: CloudState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<CloudState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Supabase erst laden, wenn es gebraucht wird (hält den Start der App klein). */
  private getClient(): Promise<SupabaseClient> {
    this.client ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cardscanner.auth' } }),
    );
    return this.client;
  }

  async init(store: SyncingStore, onRemoteChange: () => void) {
    this.store = store;
    this.onRemoteChange = onRemoteChange;
    store.onChange = () => this.syncSoon();
    await this.countPending();
    if (!cloudConfigured) return;
    window.addEventListener('online', () => this.syncNow());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.syncNow());
    try {
      const client = await this.getClient();
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') this.signedOut();
        else if (session?.user && session.user.id !== this.userId) setTimeout(() => this.signedIn(session.user));
      });
      const { data } = await client.auth.getSession();
      if (data.session?.user) await this.signedIn(data.session.user);
      else this.set({ status: 'signed-out' });
    } catch (e) {
      this.set({ status: 'error', message: (e as Error).message });
    }
  }

  private userId: string | undefined;

  private async signedIn(user: User) {
    if (!this.store || this.userId === user.id) return;
    this.userId = user.id;
    const { SupabaseCollection } = await import('../storage/supabase');
    this.engine = new SyncEngine(this.store, new SupabaseCollection(await this.getClient()), user.id);
    this.set({ signedIn: true, email: user.email, status: 'syncing', message: undefined });
    try {
      await this.engine.prepare();
      // Erste Anmeldung oder Kontowechsel: Karten vom Gerät hochladen bzw. Speicher geleert
      this.onRemoteChange();
      await this.syncNow();
    } catch (e) {
      this.failed(e);
    }
  }

  private signedOut() {
    this.userId = undefined;
    this.engine = null;
    this.set({ status: 'signed-out', signedIn: false, message: undefined });
  }

  async sendCode(email: string) {
    const client = await this.getClient();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
    });
    if (error) throw new Error(authMessage(error.message));
    this.set({ status: 'code-sent', email, message: undefined });
  }

  async verifyCode(email: string, code: string) {
    const client = await this.getClient();
    const { data, error } = await client.auth.verifyOtp({ email, token: code.replace(/\s/g, ''), type: 'email' });
    if (error) throw new Error(authMessage(error.message));
    if (data.user) await this.signedIn(data.user);
  }

  /** Zurück zur Eingabe der E-Mail-Adresse. */
  restart() {
    this.set({ status: 'signed-out', message: undefined });
  }

  /**
   * Abmelden entfernt die Karten vom Gerät (sie liegen auf dem Server). Vorher muss alles gesendet
   * sein, sonst gingen offline gescannte Karten verloren.
   */
  async signOut() {
    if (this.engine) {
      await this.syncNow();
      const pending = (await this.store!.outbox.list()).length;
      if (pending) throw new Error(`${pending} ${pending === 1 ? 'Änderung ist' : 'Änderungen sind'} noch nicht auf dem Server. Bitte mit Internet erneut versuchen.`);
      await this.engine.clearLocal();
    }
    const client = await this.getClient();
    await client.auth.signOut();
    this.signedOut();
    this.onRemoteChange();
  }

  syncSoon() {
    this.countPending();
    if (!this.engine) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), DEBOUNCE_MS);
  }

  async syncNow() {
    clearTimeout(this.timer);
    if (!this.engine) return;
    await this.run(() => this.engine!.sync());
  }

  /** Immer nur ein Abgleich gleichzeitig; Änderungen währenddessen lösen danach einen weiteren aus. */
  private async run(task: () => Promise<{ changed: boolean }>) {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (!navigator.onLine) {
      this.set({ status: 'offline' });
      await this.countPending();
      return;
    }
    this.set({ status: 'syncing', message: undefined });
    this.running = (async () => {
      try {
        const { changed } = await task();
        const lastSync = new Date().toISOString();
        writeLastSync(lastSync);
        this.set({ status: 'synced', lastSync });
        if (changed) this.onRemoteChange();
      } catch (e) {
        this.failed(e);
      } finally {
        await this.countPending();
        this.running = null;
      }
    })();
    await this.running;
    if (this.again) {
      this.again = false;
      await this.syncNow();
    }
  }

  private failed(e: unknown) {
    this.set({ status: navigator.onLine ? 'error' : 'offline', message: (e as Error).message });
  }

  private async countPending() {
    if (this.store) this.set({ pending: (await this.store.outbox.list()).length });
  }
}

export const cloud = new Cloud();

export function useCloud(): CloudState {
  const [state, setState] = useState(cloud.state);
  useEffect(() => {
    setState(cloud.state);
    return cloud.subscribe(setState);
  }, []);
  return state;
}

/** Häufige Meldungen von Supabase auf Deutsch. */
function authMessage(message: string): string {
  if (/rate limit|security purposes/i.test(message)) return 'Zu viele Versuche. Bitte in ein paar Minuten noch einmal.';
  if (/email/i.test(message) && /valid/i.test(message)) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  if (/expired|invalid/i.test(message)) return 'Der Code stimmt nicht oder ist abgelaufen.';
  return message;
}

function readLastSync(): string | undefined {
  try {
    return localStorage.getItem(LAST_SYNC_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLastSync(value: string) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, value);
  } catch {
    /* ohne Speicher zeigt die App den Zeitpunkt nur bis zum Neuladen */
  }
}
