import { useEffect, useState } from 'preact/hooks';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SyncEngine } from '../core/sync';
import { DeckSync } from '../core/deckSync';
import type { DeckStore } from '../storage/decks';
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
/** VITE_CLOUD=off schaltet Konto und Server ab; der Kamera-Test (e2e.yml) prüft das Scannen ohne Anmeldung. */
export const cloudConfigured = !!(URL && KEY) && import.meta.env.VITE_CLOUD !== 'off';

export type CloudStatus = 'off' | 'loading' | 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudState {
  status: CloudStatus;
  signedIn: boolean;
  /** Über den Link „Passwort vergessen“ gekommen: erst ein neues Passwort setzen. */
  recovery?: boolean;
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
  private decks: DeckStore | null = null;
  private deckSync: DeckSync | null = null;
  /** Die Tabelle für Decks fehlt auf dem Server noch: Decks bleiben bis dahin nur auf dem Gerät. */
  private decksUnavailable = false;
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
  getClient(): Promise<SupabaseClient> {
    this.client ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cardscanner.auth' } }),
    );
    return this.client;
  }

  async init(store: SyncingStore, decks: DeckStore, onRemoteChange: () => void) {
    this.store = store;
    this.decks = decks;
    this.onRemoteChange = onRemoteChange;
    store.onChange = () => this.syncSoon();
    decks.onChange = () => this.syncSoon();
    await this.countPending();
    if (!cloudConfigured) return;
    window.addEventListener('online', () => this.syncNow());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.syncNow());
    try {
      const client = await this.getClient();
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') this.set({ recovery: true });
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
    const { SupabaseCollection, SupabaseDecks } = await import('../storage/supabase');
    const client = await this.getClient();
    this.engine = new SyncEngine(this.store, new SupabaseCollection(client), user.id);
    this.deckSync = this.decks && new DeckSync(this.decks, new SupabaseDecks(client), user.id, this.store.outbox);
    this.set({ signedIn: true, email: user.email, status: 'syncing', message: undefined });
    try {
      await this.engine.prepare();
      await this.deckSync?.prepare();
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
    this.deckSync = null;
    this.set({ status: 'signed-out', signedIn: false, message: undefined });
  }

  async signIn(email: string, password: string) {
    const client = await this.getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(authMessage(error.message));
    if (data.user) await this.signedIn(data.user);
  }

  /** Neues Konto. In Supabase ist „Confirm email“ aus, man ist danach direkt angemeldet. */
  async signUp(email: string, password: string) {
    const client = await this.getClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw new Error(authMessage(error.message));
    if (!data.session) throw new Error('Konto angelegt. Bitte erst den Link in der E-Mail bestätigen, dann anmelden.');
    if (data.user) await this.signedIn(data.user);
  }

  /** Schickt einen Link zum Zurücksetzen; er öffnet die App im Browser mit dem Formular für ein neues Passwort. */
  async resetPassword(email: string) {
    const client = await this.getClient();
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${import.meta.env.BASE_URL}` });
    if (error) throw new Error(authMessage(error.message));
  }

  async setNewPassword(password: string) {
    const client = await this.getClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(authMessage(error.message));
    this.set({ recovery: false });
  }

  /**
   * Neue E-Mail-Adresse. Supabase schickt dafür einen Bestätigungslink; bis er geöffnet ist, bleibt die alte
   * Adresse gültig. Gibt true zurück, wenn die Änderung noch auf die Bestätigung wartet.
   */
  async changeEmail(email: string): Promise<boolean> {
    const client = await this.getClient();
    const { data, error } = await client.auth.updateUser({ email }, { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` });
    if (error) throw new Error(authMessage(error.message));
    const waiting = !!data.user?.new_email && data.user.email !== email;
    if (!waiting) this.set({ email: data.user?.email ?? email });
    return waiting;
  }

  /** Neues Passwort; das bisherige wird vorher geprüft, damit niemand am offenen Handy es ändern kann. */
  async changePassword(current: string, next: string) {
    const client = await this.getClient();
    const email = this.state.email;
    if (!email) throw new Error('Nicht angemeldet.');
    const check = await client.auth.signInWithPassword({ email, password: current });
    if (check.error) throw new Error(/invalid login credentials/i.test(check.error.message) ? 'Das bisherige Passwort stimmt nicht.' : authMessage(check.error.message));
    const { error } = await client.auth.updateUser({ password: next });
    if (error) throw new Error(authMessage(error.message));
  }

  /**
   * Abmelden entfernt die Karten vom Gerät (sie liegen auf dem Server). Vorher muss alles gesendet
   * sein, sonst gingen offline gescannte Karten verloren.
   */
  async signOut() {
    if (this.engine) {
      await this.syncNow();
      const pending = (await this.store!.outbox.list()).length + (this.decksUnavailable ? 0 : ((await this.decks?.pending())?.length ?? 0));
      if (pending) throw new Error(`${pending} ${pending === 1 ? 'Änderung ist' : 'Änderungen sind'} noch nicht auf dem Server. Bitte mit Internet erneut versuchen.`);
      await this.engine.clearLocal();
      // Ohne Tabelle auf dem Server bleiben die Decks auf dem Gerät (sie gehören weiter diesem Konto)
      if (!this.decksUnavailable) await this.deckSync?.clearLocal();
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
    await this.run(async () => {
      const { changed } = await this.engine!.sync();
      return { changed: (await this.syncDecks()) || changed };
    });
  }

  /** Decks abgleichen; fehlt die Tabelle auf dem Server noch, bleiben sie still auf dem Gerät. */
  private async syncDecks(): Promise<boolean> {
    if (!this.deckSync) return false;
    try {
      const changed = await this.deckSync.sync();
      this.decksUnavailable = false;
      return changed;
    } catch (e) {
      const { DecksUnavailable } = await import('../storage/supabase');
      if (!(e instanceof DecksUnavailable)) throw e;
      this.decksUnavailable = true;
      return false;
    }
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
    if (!this.store) return;
    const decks = this.engine && !this.decksUnavailable ? ((await this.decks?.pending())?.length ?? 0) : 0;
    this.set({ pending: (await this.store.outbox.list()).length + decks });
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
  if (/invalid login credentials/i.test(message)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/already registered|already been registered/i.test(message)) return 'Für diese E-Mail gibt es schon ein Konto.';
  if (/same.*password|different from the old/i.test(message)) return 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'Das Passwort ist zu kurz (mindestens 6 Zeichen).';
  if (/expired|invalid/i.test(message)) return 'Der Link ist abgelaufen. Bitte neu anfordern.';
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
