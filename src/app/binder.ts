import { folderIndex, HIGHLIGHT_FOLDER, HIGHLIGHT_NAME, isHighlight, PROMO_FOLDER, slotOrder } from '../core/folders';
import type { CardSet, CollectionItem, Printing } from '../core/types';

/**
 * Binder je Set: jeder Druck hat einen festen Platz, sortiert nach Sammlernummer, 9 Plätze je Seite.
 * Die Promo-Sets teilen sich einen Binder, darin nach Set und Nummer. Dazu kommt ein Gesamtordner mit allen
 * Rare, Epic und Showcase über alle Sets, und eigene Alben mit Karten nach Wahl.
 */

export const PER_PAGE = 9;

export interface Slot {
  /** „gameId|printingId“, wie in prefs.binderNew */
  key: string;
  printing: Printing;
  /** Stückzahl über alle Sprachen, Zustände und Ausführungen */
  quantity: number;
  foil: boolean;
}

export interface Binder {
  /** „gameId|setCode“, wie die eingeklappten Sets */
  key: string;
  gameId: string;
  /** Set-Kürzel, z. B. „OGN“, oder PROMO_FOLDER */
  code: string;
  /** Sammelt mehrere Sets (Promos): Plätze zeigen dann auch das Set-Kürzel */
  mixed: boolean;
  name: string;
  slots: Slot[];
  owned: number;
  /** Eigenes Album: dessen Id (Plätze in der Reihenfolge, in der die Karten dazukamen). */
  album?: string;
}

export const slotKey = (gameId: string, printingId: string) => `${gameId}|${printingId}`;

export function buildBinders(
  gameIds: Iterable<string>,
  byGame: Map<string, Map<string, Printing>>,
  sets: Map<string, CardSet[]>,
  items: Pick<CollectionItem, 'gameId' | 'printingId' | 'quantity' | 'finish'>[],
): Binder[] {
  const owned = ownedSlots(items);
  const binders: (Binder & { rank: number })[] = [];
  for (const gameId of [...new Set(gameIds)].sort()) {
    const list = sets.get(gameId) ?? [];
    const folderOf = folderIndex(list);
    const order = slotOrder(list);
    const setOf = new Map(list.map((s) => [s.code, s]));
    const byFolder = new Map<string, Printing[]>();
    const highlights: Printing[] = [];
    for (const p of byGame.get(gameId)?.values() ?? []) {
      const code = folderOf(p.setCode).code;
      byFolder.set(code, [...(byFolder.get(code) ?? []), p]);
      if (isHighlight(p, setOf.get(p.setCode))) highlights.push(p);
    }
    // Gesamtordner hinter allen Sets und den Promos
    if (highlights.length) byFolder.set(HIGHLIGHT_FOLDER, highlights);
    for (const [code, printings] of byFolder) {
      printings.sort(order);
      const slots = printings.map((printing) => {
        const key = slotKey(gameId, printing.printingId);
        return { key, printing, quantity: owned.get(key)?.quantity ?? 0, foil: owned.get(key)?.foil ?? false };
      });
      const folder =
        code === HIGHLIGHT_FOLDER ? { name: HIGHLIGHT_NAME, rank: list.length + 1 } : folderOf(printings[0].setCode);
      binders.push({
        key: `${gameId}|${code}`,
        gameId,
        code,
        mixed: code === PROMO_FOLDER || code === HIGHLIGHT_FOLDER,
        name: folder.name,
        slots,
        owned: slots.filter((s) => s.quantity > 0).length,
        rank: folder.rank,
      });
    }
  }
  return binders
    .sort((a, b) => a.gameId.localeCompare(b.gameId) || a.rank - b.rank || a.key.localeCompare(b.key))
    .map(({ rank: _, ...b }) => b);
}

type Owned = Pick<CollectionItem, 'gameId' | 'printingId' | 'quantity' | 'finish'>;

/** Stückzahl und Foil je Platz („gameId|printingId“). */
function ownedSlots(items: Owned[]) {
  const owned = new Map<string, { quantity: number; foil: boolean }>();
  for (const i of items) {
    const key = slotKey(i.gameId, i.printingId);
    const o = owned.get(key) ?? { quantity: 0, foil: false };
    owned.set(key, { quantity: o.quantity + i.quantity, foil: o.foil || i.finish === 'foil' });
  }
  return owned;
}

/** Eigenes Album als Binder: Karten in der Reihenfolge des Albums, Unbekanntes (nicht im Katalog) fällt weg. */
export function albumBinder(
  album: { id: string; name: string; cards: string[] },
  byGame: Map<string, Map<string, Printing>>,
  items: Owned[],
  fallbackGameId: string,
): Binder {
  const owned = ownedSlots(items);
  const slots: Slot[] = [];
  for (const key of new Set(album.cards)) {
    const [gameId, printingId] = splitKey(key);
    const printing = byGame.get(gameId)?.get(printingId);
    if (!printing) continue;
    slots.push({ key, printing, quantity: owned.get(key)?.quantity ?? 0, foil: owned.get(key)?.foil ?? false });
  }
  const gameId = slots[0] ? splitKey(slots[0].key)[0] : fallbackGameId;
  return {
    key: `${gameId}|album:${album.id}`,
    gameId,
    code: '',
    mixed: true,
    name: album.name,
    slots,
    owned: slots.filter((s) => s.quantity > 0).length,
    album: album.id,
  };
}

/** „gameId|printingId“ zerlegen (die printingId darf selbst „|“ enthalten). */
export function splitKey(key: string): [string, string] {
  const i = key.indexOf('|');
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Seiten eines Binders (je PER_PAGE Plätze). */
export function pages<T>(slots: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < slots.length; i += PER_PAGE) out.push(slots.slice(i, i + PER_PAGE));
  return out;
}

/** Ein Vorkommen entfernen (das letzte), z. B. beim Rückgängig eines Scans. */
export function withoutLast(list: string[], key: string): string[] {
  const i = list.lastIndexOf(key);
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

/** Ein Vorkommen entfernen (das erste), wenn eine Karte gelandet ist. */
export function withoutFirst(list: string[], key: string): string[] {
  const i = list.indexOf(key);
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}
