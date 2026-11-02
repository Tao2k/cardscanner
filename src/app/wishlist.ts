import { useEffect, useState } from 'preact/hooks';
import { wishKey, withWish, withoutWish, type Wish } from '../core/wishlist';
import type { WishlistApi } from '../storage/wishlist';
import { cloud, useCloud } from './cloud';

export interface WishlistState {
  wishes: Wish[];
  /** Schlüssel „gameId|printingId“ der Wünsche, zum schnellen Nachsehen. */
  keys: Set<string>;
  /** ready = geladen; unavailable = Tabelle auf dem Server fehlt noch (0004 nicht ausgeführt). */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  message?: string;
}

const EMPTY: WishlistState = { wishes: [], keys: new Set(), status: 'idle' };

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
        const wishes = await (await this.client()).list();
        if (this.owner === owner) this.set({ wishes, status: 'ready' });
      } catch (e) {
        if (this.owner === owner) await this.failed(e);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private async failed(e: unknown) {
    const { WishlistUnavailable } = await import('../storage/wishlist');
    if (e instanceof WishlistUnavailable) this.set({ status: 'unavailable', message: undefined });
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
