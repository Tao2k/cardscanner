import type { CollectionItem, Finish } from './types';

/** Anzahl je Druck und Ausführung aus der Sammlung eines Freundes (mehr sehen Freunde nicht). */
export interface FriendCard {
  gameId: string;
  printingId: string;
  finish: Finish;
  quantity: number;
}

/** Eine Karte, die eine Seite übrig hat und der anderen fehlt. */
export interface TradeCard {
  gameId: string;
  printingId: string;
  /** Wie viele Exemplare übrig sind (über die behaltenen hinaus). */
  spare: number;
  /** Ausführung des übrigen Exemplars, das am meisten vorhanden ist (für den Preis). */
  finish: Finish;
}

export interface Trade {
  /** Hat der Freund übrig, fehlt dir. */
  get: TradeCard[];
  /** Hast du übrig, fehlt dem Freund. */
  give: TradeCard[];
}

/** Wie viele Exemplare man von jeder Karte behält; alles darüber gilt als übrig. */
export const KEEP = 1;

type Owned = Pick<CollectionItem, 'gameId' | 'printingId' | 'finish' | 'quantity'>;

/** Anzahl je Druck (über Sprache, Ausführung und Zustand zusammengezählt) und die häufigste Ausführung. */
function byPrinting(cards: Owned[]): Map<string, { gameId: string; printingId: string; quantity: number; finish: Finish }> {
  const counts = new Map<string, { gameId: string; printingId: string; quantity: number; finishes: Map<Finish, number> }>();
  for (const c of cards) {
    if (c.quantity <= 0) continue;
    const key = `${c.gameId}|${c.printingId}`;
    let entry = counts.get(key);
    if (!entry) counts.set(key, (entry = { gameId: c.gameId, printingId: c.printingId, quantity: 0, finishes: new Map() }));
    entry.quantity += c.quantity;
    entry.finishes.set(c.finish, (entry.finishes.get(c.finish) ?? 0) + c.quantity);
  }
  return new Map(
    [...counts].map(([key, e]) => [
      key,
      { gameId: e.gameId, printingId: e.printingId, quantity: e.quantity, finish: [...e.finishes].sort((a, b) => b[1] - a[1])[0][0] },
    ]),
  );
}

function spares(from: Owned[], to: Owned[], keep: number): TradeCard[] {
  const have = byPrinting(from);
  const needs = byPrinting(to);
  const result: TradeCard[] = [];
  for (const [key, card] of have) {
    const spare = card.quantity - keep;
    if (spare > 0 && !needs.has(key)) result.push({ gameId: card.gameId, printingId: card.printingId, spare, finish: card.finish });
  }
  return result;
}

/**
 * Was zwei Sammlungen tauschen könnten: Karten, von denen eine Seite mehr als `keep` Exemplare hat
 * und die der anderen ganz fehlen. Sprache, Ausführung und Zustand zählen dabei nicht getrennt.
 */
export function tradeBetween(mine: Owned[], friend: Owned[], keep = KEEP): Trade {
  return { get: spares(friend, mine, keep), give: spares(mine, friend, keep) };
}
