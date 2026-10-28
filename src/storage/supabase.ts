import type { SupabaseClient } from '@supabase/supabase-js';
import type { RemoteCollection, RemoteRow } from '../core/sync';
import type { CollectionItem } from '../core/types';
import type { PendingChange } from './outbox';

const TABLE = 'collection_items';
/** Supabase liefert höchstens 1000 Zeilen je Abfrage. */
const PAGE = 1000;

interface Row {
  item_id: string;
  game_id: string | null;
  printing_id: string | null;
  language: string | null;
  quantity: number | null;
  condition: string | null;
  finish: string | null;
  location: string | null;
  notes: string | null;
  confirmed: boolean | null;
  extra: { matchScore?: number; alternatives?: string[] } | null;
  added_at: string | null;
  updated_at: string | null;
  deleted: boolean;
  changed_at: string;
  server_updated_at: string;
}

function toRow(change: PendingChange & { item: CollectionItem }) {
  const { item } = change;
  const extra: Row['extra'] = {};
  if (item.matchScore !== undefined) extra.matchScore = item.matchScore;
  if (item.alternatives !== undefined) extra.alternatives = item.alternatives;
  return {
    item_id: item.itemId,
    game_id: item.gameId,
    printing_id: item.printingId,
    language: item.language,
    quantity: item.quantity,
    condition: item.condition,
    finish: item.finish,
    location: item.location,
    notes: item.notes,
    confirmed: item.confirmed,
    extra,
    added_at: item.addedAt,
    updated_at: item.updatedAt,
    deleted: false,
    changed_at: change.changedAt,
  };
}

function fromRow(row: Row): RemoteRow {
  if (row.deleted || !row.game_id || !row.printing_id) return { itemId: row.item_id, deleted: true, serverUpdatedAt: row.server_updated_at };
  const item: CollectionItem = {
    itemId: row.item_id,
    gameId: row.game_id,
    printingId: row.printing_id,
    language: row.language ?? 'en',
    quantity: row.quantity ?? 1,
    condition: (row.condition ?? 'NM') as CollectionItem['condition'],
    finish: (row.finish ?? 'normal') as CollectionItem['finish'],
    location: row.location ?? '',
    notes: row.notes ?? '',
    confirmed: row.confirmed ?? true,
    addedAt: row.added_at ?? row.changed_at,
    updatedAt: row.updated_at ?? row.changed_at,
  };
  if (row.extra?.matchScore !== undefined) item.matchScore = row.extra.matchScore;
  if (row.extra?.alternatives !== undefined) item.alternatives = row.extra.alternatives;
  return { itemId: row.item_id, item, deleted: false, serverUpdatedAt: row.server_updated_at };
}

/** Sammlung der angemeldeten Person in Supabase (Tabelle collection_items, siehe supabase/migrations). */
export class SupabaseCollection implements RemoteCollection {
  constructor(private readonly client: SupabaseClient) {}

  async push(changes: PendingChange[]): Promise<void> {
    const items = changes.filter((c): c is PendingChange & { item: CollectionItem } => !c.deleted && !!c.item).map(toRow);
    // Gelöschte getrennt senden: so bleiben Karte, Anzahl usw. der Zeile unangetastet
    const deleted = changes.filter((c) => c.deleted).map((c) => ({ item_id: c.itemId, deleted: true, changed_at: c.changedAt }));
    for (const rows of [items, deleted]) {
      for (let i = 0; i < rows.length; i += PAGE) {
        const { error } = await this.client.from(TABLE).upsert(rows.slice(i, i + PAGE), { onConflict: 'user_id,item_id' });
        if (error) throw new Error(error.message);
      }
    }
  }

  async pull(since: string | null): Promise<RemoteRow[]> {
    const rows: RemoteRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = this.client.from(TABLE).select('*').order('server_updated_at').order('item_id').range(from, from + PAGE - 1);
      if (since) query = query.gte('server_updated_at', since);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...(data as Row[]).map(fromRow));
      if (data.length < PAGE) return rows;
    }
  }

  async count(): Promise<number> {
    const { count, error } = await this.client.from(TABLE).select('item_id', { count: 'exact', head: true }).eq('deleted', false);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}
