import type { SupabaseClient } from '@supabase/supabase-js';
import type { Album } from '../core/albums';

const TABLE = 'albums';

/** Tabelle oder Funktion aus supabase/migrations/0006_albums.sql fehlt noch. */
export class AlbumsUnavailable extends Error {}

function albumError(error: { message: string; code?: string }): Error {
  // PGRST205: Tabelle nicht im Schema, 42P01: Tabelle gibt es nicht, PGRST202/42883: Funktion fehlt
  if (['PGRST205', '42P01', 'PGRST202', '42883'].includes(error.code ?? '')) return new AlbumsUnavailable(error.message);
  return new Error(error.message);
}

interface AlbumRow {
  id: string;
  name: string;
  cards: string[] | null;
  created_at: string;
  updated_at: string;
}

const fromRow = (r: AlbumRow): Album => ({ id: r.id, name: r.name, cards: r.cards ?? [], createdAt: r.created_at, updatedAt: r.updated_at });
const COLUMNS = 'id, name, cards, created_at, updated_at';

/** Eigene Alben (Tabelle albums, 0006) und die der Freunde. */
export class AlbumsApi {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Album[]> {
    const { data, error } = await this.client.from(TABLE).select(COLUMNS).order('created_at');
    if (error) throw albumError(error);
    return (data as AlbumRow[]).map(fromRow);
  }

  async create(name: string, cards: string[] = []): Promise<Album> {
    const { data, error } = await this.client.from(TABLE).insert({ name, cards }).select(COLUMNS).single();
    if (error) throw albumError(error);
    return fromRow(data as AlbumRow);
  }

  async update(album: Pick<Album, 'id' | 'name' | 'cards'>): Promise<void> {
    const { error } = await this.client.from(TABLE).update({ name: album.name, cards: album.cards }).eq('id', album.id);
    if (error) throw albumError(error);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq('id', id);
    if (error) throw albumError(error);
  }

  /** Alben eines bestätigten Freundes. */
  async ofFriend(userId: string): Promise<Album[]> {
    const { data, error } = await this.client.rpc('friend_albums', { friend: userId });
    if (error) throw albumError(error);
    return (data as AlbumRow[]).map(fromRow);
  }
}
