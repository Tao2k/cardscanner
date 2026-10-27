import { compareCollectorNumbers, setRanks } from '../core/excel';
import type { CardSet, CollectionItem, Printing } from '../core/types';

/** Binder je Set: jeder Druck hat einen festen Platz, sortiert nach Sammlernummer, 9 Plätze je Seite. */

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
  name: string;
  slots: Slot[];
  owned: number;
}

export const slotKey = (gameId: string, printingId: string) => `${gameId}|${printingId}`;

export function buildBinders(
  gameIds: Iterable<string>,
  byGame: Map<string, Map<string, Printing>>,
  sets: Map<string, CardSet[]>,
  items: CollectionItem[],
): Binder[] {
  const owned = new Map<string, { quantity: number; foil: boolean }>();
  for (const i of items) {
    const key = slotKey(i.gameId, i.printingId);
    const o = owned.get(key) ?? { quantity: 0, foil: false };
    owned.set(key, { quantity: o.quantity + i.quantity, foil: o.foil || i.finish === 'foil' });
  }
  const binders: (Binder & { rank: number })[] = [];
  for (const gameId of [...new Set(gameIds)].sort()) {
    const list = sets.get(gameId) ?? [];
    const ranks = setRanks(list);
    const bySet = new Map<string, Printing[]>();
    for (const p of byGame.get(gameId)?.values() ?? []) bySet.set(p.setCode, [...(bySet.get(p.setCode) ?? []), p]);
    for (const [code, printings] of bySet) {
      printings.sort((a, b) => compareCollectorNumbers(a.collectorNumber, b.collectorNumber) || a.cardName.localeCompare(b.cardName));
      const slots = printings.map((printing) => {
        const key = slotKey(gameId, printing.printingId);
        return { key, printing, quantity: owned.get(key)?.quantity ?? 0, foil: owned.get(key)?.foil ?? false };
      });
      binders.push({
        key: `${gameId}|${code}`,
        gameId,
        name: list.find((s) => s.code === code)?.name ?? (code || 'Ohne Set'),
        slots,
        owned: slots.filter((s) => s.quantity > 0).length,
        rank: ranks.get(code) ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }
  return binders
    .sort((a, b) => a.gameId.localeCompare(b.gameId) || a.rank - b.rank || a.key.localeCompare(b.key))
    .map(({ rank: _, ...b }) => b);
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
