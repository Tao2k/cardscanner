import { useEffect, useState } from 'preact/hooks';
import { albumName, sortAlbums, withCard, withoutCard, type Album } from '../core/albums';
import type { AlbumsApi } from '../storage/albums';
import { cloud, useCloud } from './cloud';

export interface AlbumsState {
  albums: Album[];
  /** ready = geladen; unavailable = Tabelle auf dem Server fehlt noch (0006 nicht ausgeführt). */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  message?: string;
}

const EMPTY: AlbumsState = { albums: [], status: 'idle' };

/**
 * Eigene Alben der angemeldeten Person. Sie liegen nur auf dem Server (wie die Wunschliste);
 * Änderungen erscheinen sofort und werden zurückgenommen, wenn der Server sie ablehnt.
 */
class Albums {
  state: AlbumsState = EMPTY;
  private listeners = new Set<(s: AlbumsState) => void>();
  private api: Promise<AlbumsApi> | null = null;
  private owner: string | undefined;
  private loading: Promise<void> | null = null;
  /** Änderungen je Album nacheinander senden, damit die letzte gewinnt. */
  private queue = new Map<string, Promise<void>>();

  subscribe(fn: (s: AlbumsState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AlbumsState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private client(): Promise<AlbumsApi> {
    this.api ??= Promise.all([cloud.getClient(), import('../storage/albums')]).then(([client, { AlbumsApi }]) => new AlbumsApi(client));
    return this.api;
  }

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
    if (this.state.status !== 'ready') this.set({ status: 'loading', message: undefined });
    this.loading = (async () => {
      try {
        const albums = await (await this.client()).list();
        if (this.owner === owner) this.set({ albums: sortAlbums(albums), status: 'ready' });
      } catch (e) {
        if (this.owner === owner) await this.failed(e);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private async failed(e: unknown) {
    const { AlbumsUnavailable } = await import('../storage/albums');
    if (e instanceof AlbumsUnavailable) this.set({ status: 'unavailable', message: undefined });
    else
      this.set({
        status: this.state.status === 'loading' ? 'error' : this.state.status,
        message: /fetch|network/i.test((e as Error).message) ? 'Keine Verbindung zum Server.' : (e as Error).message,
      });
  }

  get(id: string) {
    return this.state.albums.find((a) => a.id === id);
  }

  /** Neues Album, optional gleich mit einer Karte; liefert es, sobald der Server es angelegt hat. */
  async create(name: string, cards: string[] = []): Promise<Album | undefined> {
    const clean = albumName(name);
    if (!clean) return;
    try {
      const album = await (await this.client()).create(clean, cards);
      this.set({ albums: sortAlbums([...this.state.albums, album]), message: undefined });
      return album;
    } catch (e) {
      await this.failed(e);
    }
  }

  private change(id: string, fn: (a: Album) => Album) {
    const before = this.get(id);
    if (!before) return Promise.resolve();
    const after = fn(before);
    if (after === before) return Promise.resolve();
    this.set({ albums: this.state.albums.map((a) => (a.id === id ? after : a)), message: undefined });
    const send = (this.queue.get(id) ?? Promise.resolve()).then(async () => {
      try {
        // Immer den neuesten Stand senden
        const now = this.get(id);
        if (now) await (await this.client()).update(now);
      } catch (e) {
        this.set({ albums: this.state.albums.map((a) => (a.id === id ? before : a)) });
        await this.failed(e);
      }
    });
    this.queue.set(id, send);
    return send;
  }

  rename(id: string, name: string) {
    const clean = albumName(name);
    return clean ? this.change(id, (a) => (a.name === clean ? a : { ...a, name: clean })) : Promise.resolve();
  }

  has(id: string, key: string) {
    return !!this.get(id)?.cards.includes(key);
  }

  toggle(id: string, key: string) {
    return this.change(id, (a) => (a.cards.includes(key) ? withoutCard(a, key) : withCard(a, key)));
  }

  async remove(id: string) {
    const before = this.state.albums;
    if (!before.some((a) => a.id === id)) return;
    this.set({ albums: before.filter((a) => a.id !== id), message: undefined });
    try {
      await (await this.client()).remove(id);
    } catch (e) {
      this.set({ albums: before });
      await this.failed(e);
    }
  }

  /** Alben eines Freundes; leer, wenn die Funktion auf dem Server noch fehlt. */
  async ofFriend(userId: string): Promise<Album[]> {
    try {
      return sortAlbums(await (await this.client()).ofFriend(userId));
    } catch (e) {
      const { AlbumsUnavailable } = await import('../storage/albums');
      if (e instanceof AlbumsUnavailable) return [];
      throw e;
    }
  }
}

export const albums = new Albums();

/** Eigene Alben; laden beim ersten Gebrauch und nach einem Kontowechsel. */
export function useAlbums(): AlbumsState {
  const account = useCloud();
  const [state, setState] = useState(albums.state);
  useEffect(() => {
    setState(albums.state);
    return albums.subscribe(setState);
  }, []);
  useEffect(() => {
    albums.load();
  }, [account.signedIn, account.email]);
  return state;
}
