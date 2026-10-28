import type { SupabaseClient } from '@supabase/supabase-js';
import type { FriendCard } from '../core/friends';
import type { Finish } from '../core/types';

/** Supabase liefert höchstens 1000 Zeilen je Abfrage. */
const PAGE = 1000;

export interface Profile {
  displayName: string;
  friendCode: string;
}

export interface Friend {
  userId: string;
  displayName: string;
  status: 'pending' | 'accepted';
  /** Anfrage kam von der anderen Person (wartet auf deine Bestätigung). */
  incoming: boolean;
}

/** Freunde über die Funktionen in supabase/migrations/0002_friends.sql. */
export class FriendsApi {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }

  /** Eigenes Profil mit Freundescode (wird beim ersten Aufruf angelegt); optional neuen Namen setzen. */
  async profile(name?: string): Promise<Profile> {
    const rows = await this.rpc<{ display_name: string; friend_code: string }[]>('my_profile', { name: name ?? null });
    return { displayName: rows[0]?.display_name ?? '', friendCode: rows[0]?.friend_code ?? '' };
  }

  async list(): Promise<Friend[]> {
    const rows = await this.rpc<{ user_id: string; display_name: string; status: Friend['status']; incoming: boolean }[]>('my_friends');
    return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name, status: r.status, incoming: r.incoming }));
  }

  /** 'pending' = Anfrage gesendet, 'accepted' = die andere Person hatte schon angefragt. */
  add(code: string): Promise<'pending' | 'accepted'> {
    return this.rpc('add_friend', { code });
  }

  accept(userId: string): Promise<void> {
    return this.rpc('accept_friend', { other: userId });
  }

  /** Freundschaft beenden, Anfrage ablehnen oder zurückziehen. */
  async remove(userId: string): Promise<void> {
    const { error } = await this.client.from('friendships').delete().or(`requester.eq.${userId},addressee.eq.${userId}`);
    if (error) throw new Error(error.message);
  }

  async collection(userId: string): Promise<FriendCard[]> {
    const cards: FriendCard[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client.rpc('friend_collection', { friend: userId }).range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data as { game_id: string; printing_id: string; finish: string; quantity: number }[];
      cards.push(...rows.map((r) => ({ gameId: r.game_id, printingId: r.printing_id, finish: r.finish as Finish, quantity: r.quantity })));
      if (rows.length < PAGE) return cards;
    }
  }
}

/** Fehlermeldungen der Datenbankfunktionen sind schon deutsch; nur Netzfehler übersetzen. */
export function friendError(e: unknown): string {
  const message = (e as Error).message ?? String(e);
  return /fetch|network/i.test(message) ? 'Keine Verbindung zum Server.' : message;
}
