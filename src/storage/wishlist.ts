import type { SupabaseClient } from '@supabase/supabase-js';
import type { Wish } from '../core/wishlist';

const TABLE = 'wishlist';
/** Supabase liefert höchstens 1000 Zeilen je Abfrage. */
const PAGE = 1000;

/** Tabelle oder Funktion aus supabase/migrations/0004_wishlist.sql fehlt noch. */
export class WishlistUnavailable extends Error {}

function wishError(error: { message: string; code?: string }): Error {
  // PGRST205: Tabelle nicht im Schema, 42P01: Tabelle gibt es nicht, PGRST202/42883: Funktion fehlt
  if (['PGRST205', '42P01', 'PGRST202', '42883'].includes(error.code ?? '')) return new WishlistUnavailable(error.message);
  return new Error(error.message);
}

interface WishRow {
  game_id: string;
  printing_id: string;
  quantity: number;
  created_at?: string;
}

const fromRow = (r: WishRow): Wish => ({ gameId: r.game_id, printingId: r.printing_id, quantity: r.quantity, addedAt: r.created_at ?? '' });

/** Wunschliste der angemeldeten Person und die ihrer Freunde (Tabelle wishlist, 0004). */
export class WishlistApi {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Wish[]> {
    const wishes: Wish[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from(TABLE)
        .select('game_id, printing_id, quantity, created_at')
        .order('created_at', { ascending: false })
        .order('printing_id')
        .range(from, from + PAGE - 1);
      if (error) throw wishError(error);
      wishes.push(...(data as WishRow[]).map(fromRow));
      if (data.length < PAGE) return wishes;
    }
  }

  async add(wish: Wish): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .upsert({ game_id: wish.gameId, printing_id: wish.printingId, quantity: wish.quantity }, { onConflict: 'user_id,game_id,printing_id' });
    if (error) throw wishError(error);
  }

  async remove(gameId: string, printingId: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq('game_id', gameId).eq('printing_id', printingId);
    if (error) throw wishError(error);
  }

  /** Wunschliste eines bestätigten Freundes. */
  async ofFriend(userId: string): Promise<Wish[]> {
    const wishes: Wish[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client.rpc('friend_wishlist', { friend: userId }).range(from, from + PAGE - 1);
      if (error) throw wishError(error);
      const rows = data as WishRow[];
      wishes.push(...rows.map(fromRow));
      if (rows.length < PAGE) return wishes;
    }
  }
}
