import { useEffect, useMemo, useState } from 'preact/hooks';
import { priceFor } from '../core/prices';
import type { Printing } from '../core/types';
import { watchWishes, wishAlerts, wishKey, withWish, withoutWish, type Wish, type WishAlert, type WishWatches } from '../core/wishlist';
import type { WishlistApi } from '../storage/wishlist';
import type { Catalogs } from './App';
import { cloud, useCloud } from './cloud';

export interface WishlistState {
  wishes: Wish[];
  /** Schlüssel „gameId|printingId“ der Wünsche, zum schnellen Nachsehen. */
  keys: Set<string>;
  /** ready = geladen; unavailable = Tabelle auf dem Server fehlt noch (0004 nicht ausgeführt). */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  message?: string;
  /** false, solange der Server keine Zielpreise speichern kann (0005 nicht ausgeführt). */
  targets: boolean;
}

const EMPTY: WishlistState = { wishes: [], keys: new Set(), status: 'idle', targets: true };

/**
 * Wunschliste der angemeldeten Person. Sie liegt nur auf dem Server (Tausch geht ohnehin nur online);
 * Änderungen erscheinen sofort und werden zurückgenommen, wenn der Server sie ablehnt.
 */
class Wishlist {
  state: WishlistState = EMPTY;
  private listeners = new Set<(s: WishlistState) => void>();
  private api: Promise<WishlistApi> | null = null;
  /** Konto, dessen Liste geladen ist. */
  private owner: string | undefined;
  private loading: Promise<void> | null = null;

  subscribe(fn: (s: WishlistState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<WishlistState>) {
    const next = { ...this.state, ...patch };
    if (patch.wishes) next.keys = new Set(patch.wishes.map(wishKey));
    this.state = next;
    for (const fn of this.listeners) fn(this.state);
  }

  private client(): Promise<WishlistApi> {
    this.api ??= Promise.all([cloud.getClient(), import('../storage/wishlist')]).then(([client, { WishlistApi }]) => new WishlistApi(client));
    return this.api;
  }

  /** Laden, falls für dieses Konto noch nicht geschehen (oder neu, mit force). */
  load(force = false): Promise<void> {
    const owner = cloud.state.email;
    if (!cloud.state.signedIn) {
      this.owner = undefined;
      if (this.state !== EMPTY) this.set({ ...EMPTY });
      return Promise.resolve();
    }
    if (!force && this.owner === owner && (this.loading || this.state.status === 'ready')) return this.loading ?? Promise.resolve();
    if (this.owner !== owner) this.set({ ...EMPTY });
    this.owner = owner;
    this.set({ status: 'loading', message: undefined });
    this.loading = (async () => {
      try {
        const api = await this.client();
        const wishes = await api.list();
        if (this.owner === owner) this.set({ wishes, status: 'ready', targets: api.targets });
      } catch (e) {
        if (this.owner === owner) await this.failed(e);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private async failed(e: unknown) {
    const { WishlistUnavailable, TargetUnavailable } = await import('../storage/wishlist');
    if (e instanceof TargetUnavailable) this.set({ targets: false, message: 'Zielpreise sind auf dem Server noch nicht eingerichtet.' });
    else if (e instanceof WishlistUnavailable) this.set({ status: 'unavailable', message: undefined });
    else this.set({ status: this.state.status === 'loading' ? 'error' : this.state.status, message: /fetch|network/i.test((e as Error).message) ? 'Keine Verbindung zum Server.' : (e as Error).message });
  }

  has(gameId: string, printingId: string) {
    return this.state.keys.has(wishKey({ gameId, printingId }));
  }

  async add(gameId: string, printingId: string) {
    if (this.has(gameId, printingId)) return;
    const wish: Wish = { gameId, printingId, quantity: 1, addedAt: new Date().toISOString() };
    const before = this.state.wishes;
    this.set({ wishes: withWish(before, wish), message: undefined });
    try {
      await (await this.client()).add(wish);
    } catch (e) {
      this.set({ wishes: withoutWish(this.state.wishes, wishKey(wish)) });
      await this.failed(e);
    }
  }

  async remove(gameId: string, printingId: string) {
    const key = wishKey({ gameId, printingId });
    const old = this.state.wishes.find((w) => wishKey(w) === key);
    if (!old) return;
    this.set({ wishes: withoutWish(this.state.wishes, key), message: undefined });
    try {
      await (await this.client()).remove(gameId, printingId);
    } catch (e) {
      // An der alten Stelle wieder einsetzen
      const list = [...this.state.wishes, old].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      this.set({ wishes: list });
      await this.failed(e);
    }
  }

  /** Zielpreis für den Preisalarm setzen oder (undefined) entfernen. */
  async setTarget(gameId: string, printingId: string, target: number | undefined) {
    const key = wishKey({ gameId, printingId });
    const old = this.state.wishes.find((w) => wishKey(w) === key);
    if (!old) return;
    const swap = (w: Wish) => this.set({ wishes: this.state.wishes.map((x) => (wishKey(x) === key ? w : x)), message: undefined });
    const next: Wish = { ...old };
    if (target === undefined) delete next.target;
    else next.target = target;
    swap(next);
    // Neuer Zielpreis: Erreichen wird wieder gemeldet
    wishAlarm.rearm(key);
    try {
      await (await this.client()).setTarget(gameId, printingId, target);
    } catch (e) {
      swap(old);
      await this.failed(e);
    }
  }

  toggle(gameId: string, printingId: string) {
    return this.has(gameId, printingId) ? this.remove(gameId, printingId) : this.add(gameId, printingId);
  }

  /** Wunschliste eines Freundes; leer, wenn die Funktion auf dem Server noch fehlt. */
  async ofFriend(userId: string): Promise<Wish[]> {
    try {
      return await (await this.client()).ofFriend(userId);
    } catch (e) {
      const { WishlistUnavailable } = await import('../storage/wishlist');
      if (e instanceof WishlistUnavailable) return [];
      throw e;
    }
  }
}

export const wishlist = new Wishlist();

/** Eigene Wunschliste; lädt beim ersten Gebrauch und nach einem Kontowechsel. */
export function useWishlist(): WishlistState {
  const account = useCloud();
  const [state, setState] = useState(wishlist.state);
  useEffect(() => {
    setState(wishlist.state);
    return wishlist.subscribe(setState);
  }, []);
  useEffect(() => {
    wishlist.load();
  }, [account.signedIn, account.email]);
  return state;
}

const WATCH_KEY = 'cardscanner.wishWatch';

/** Vergleichspreise für den Preisalarm der Wunschliste (nur auf diesem Gerät). */
class WishAlarm {
  watches: WishWatches = load();
  private listeners = new Set<(w: WishWatches) => void>();

  subscribe(fn: (w: WishWatches) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(next: WishWatches) {
    if (next === this.watches) return;
    this.watches = next;
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(next));
    } catch {
      /* ohne Speicher kommen die Hinweise beim nächsten Start erneut */
    }
    for (const fn of this.listeners) fn(next);
  }

  rearm(key: string) {
    const watch = this.watches[key];
    if (watch?.hit) this.set({ ...this.watches, [key]: { ref: watch.ref } });
  }
}

function load(): WishWatches {
  try {
    return JSON.parse(localStorage.getItem(WATCH_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export const wishAlarm = new WishAlarm();

/** Ausführung, mit der eine gesuchte Karte bewertet wird: Foil nur bei reinen Foil-Drucken. */
export const defaultFinish = (p?: Printing) => (p?.finishes?.length === 1 && p.finishes[0] === 'foil' ? 'foil' : 'normal');

/** Heutiger Preis eines gewünschten Drucks. */
export function wishPrice(catalogs: Catalogs, gameId: string, printingId: string): number | undefined {
  const printing = catalogs.lookup(gameId, printingId);
  return printing ? priceFor(catalogs.price(gameId, printingId), defaultFinish(printing), printing) : undefined;
}

export interface WishAlarmState {
  /** Offene Preisalarme (Zielpreis erreicht oder deutlich günstiger). */
  alerts: WishAlert[];
  /** Alarme als gesehen merken. */
  seen(alerts: WishAlert[]): void;
}

/** Preisalarme der eigenen Wunschliste; merkt neue Wünsche mit ihrem heutigen Preis vor. */
export function useWishAlarm(wish: WishlistState, catalogs: Catalogs | null): WishAlarmState {
  const [watches, setWatches] = useState(wishAlarm.watches);
  useEffect(() => wishAlarm.subscribe(setWatches), []);
  const priceOf = (w: Wish) => (catalogs ? wishPrice(catalogs, w.gameId, w.printingId) : undefined);
  const ready = wish.status === 'ready' && !!catalogs;
  useEffect(() => {
    // Erst mit geladener Liste, sonst fielen alle Vergleichspreise weg
    if (ready) wishAlarm.set(watchWishes(wish.wishes, priceOf, wishAlarm.watches));
  }, [ready, wish.wishes, catalogs]);
  const alerts = useMemo(() => (ready ? wishAlerts(wish.wishes, priceOf, watches) : []), [ready, wish.wishes, watches, catalogs]);
  return {
    alerts,
    seen: (shown) => {
      if (ready && shown.length) wishAlarm.set(watchWishes(wish.wishes, priceOf, wishAlarm.watches, shown));
    },
  };
}
