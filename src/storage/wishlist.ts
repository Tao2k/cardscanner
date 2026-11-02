import type { SupabaseClient } from '@supabase/supabase-js';
import type { Wish } from '../core/wishlist';

const TABLE = 'wishlist';
/** Supabase liefert höchstens 1000 Zeilen je Abfrage. */
const PAGE = 1000;

/** Tabelle oder Funktion aus supabase/migrations/0004_wishlist.sql fehlt noch. */
export class WishlistUnavailable extends Error {}
/** Spalte für den Zielpreis aus supabase/migrations/0005_wishlist_alarm.sql fehlt noch. */
export class TargetUnavailable extends Error {}

/** 42703: Spalte gibt es nicht, PGRST204: Spalte nicht im Schema-Cache. */
const missingColumn = (error: { code?: string }) => ['42703', 'PGRST204'].includes(error.code ?? '');

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
  max_price?: number | string | null;
}

const fromRow = (r: WishRow): Wish => {
  const wish: Wish = { gameId: r.game_id, printingId: r.printing_id, quantity: r.quantity, addedAt: r.created_at ?? '' };
  // numeric kommt je nach Größe als Zahl oder Text
  if (r.max_price !== null && r.max_price !== undefined) wish.target = Number(r.max_price);
  return wish;
};

/** Wunschliste der angemeldeten Person und die ihrer Freunde (Tabelle wishlist, 0004). */
export class WishlistApi {
  /** false, solange auf dem Server die Spalte für Zielpreise fehlt (0005 nicht ausgeführt). */
  targets = true;

  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Wish[]> {
    const wishes: Wish[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client
        .from(TABLE)
        .select(this.targets ? 'game_id, printing_id, quantity, created_at, max_price' : 'game_id, printing_id, quantity, created_at')
        .order('created_at', { ascending: false })
        .order('printing_id')
        .range(from, from + PAGE - 1);
      if (error && this.targets && missingColumn(error)) {
        // Ohne 0005 geht die Wunschliste weiter, nur ohne Zielpreise
        this.targets = false;
        return this.list();
      }
      if (error) throw wishError(error);
      wishes.push(...(data as unknown as WishRow[]).map(fromRow));
      if (data.length < PAGE) return wishes;
    }
  }

  /** Zielpreis setzen (undefined = keiner). */
  async setTarget(gameId: string, printingId: string, target: number | undefined): Promise<void> {
    if (!this.targets) throw new TargetUnavailable('max_price fehlt');
    const { error } = await this.client
      .from(TABLE)
      .update({ max_price: target ?? null })
      .eq('game_id', gameId)
      .eq('printing_id', printingId);
    if (error && missingColumn(error)) {
      this.targets = false;
      throw new TargetUnavailable(error.message);
    }
    if (error) throw wishError(error);
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
