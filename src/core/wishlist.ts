import type { Finish } from './types';

/** Ein Druck auf der Wunschliste. */
export interface Wish {
  gameId: string;
  printingId: string;
  /** Wie viele Exemplare gesucht werden (bisher immer 1). */
  quantity: number;
  /** Wann die Karte auf die Liste kam (ISO), neueste zuerst. */
  addedAt: string;
}

export const wishKey = (w: { gameId: string; printingId: string }) => `${w.gameId}|${w.printingId}`;

type Owned = { gameId: string; printingId: string; finish: Finish; quantity: number };

/** Ein Freund, der eine gewünschte Karte hat. */
export interface WishOwner {
  userId: string;
  quantity: number;
  /** Exemplare über die behaltenen hinaus. */
  spare: number;
}

/**
 * Wer von den Freunden welche gewünschte Karte hat (über Sprache, Ausführung und Zustand zusammengezählt).
 * Je Karte die Freunde mit den meisten übrigen Exemplaren zuerst.
 */
export function wishOwners(wishes: Wish[], friends: Map<string, Owned[]>, keep: number): Map<string, WishOwner[]> {
  const wanted = new Set(wishes.map(wishKey));
  const result = new Map<string, WishOwner[]>();
  for (const [userId, cards] of friends) {
    const counts = new Map<string, number>();
    for (const c of cards) {
      const key = wishKey(c);
      if (c.quantity > 0 && wanted.has(key)) counts.set(key, (counts.get(key) ?? 0) + c.quantity);
    }
    for (const [key, quantity] of counts) result.set(key, [...(result.get(key) ?? []), { userId, quantity, spare: Math.max(0, quantity - keep) }]);
  }
  for (const owners of result.values()) owners.sort((a, b) => b.spare - a.spare || b.quantity - a.quantity);
  return result;
}

/** Eintrag hinzufügen (neu oben) oder entfernen, ohne die Liste zu verändern. */
export function withWish(list: Wish[], wish: Wish): Wish[] {
  return [wish, ...list.filter((w) => wishKey(w) !== wishKey(wish))];
}

export function withoutWish(list: Wish[], key: string): Wish[] {
  return list.filter((w) => wishKey(w) !== key);
}
