import { isStrong } from './priceHistory';
import type { Finish } from './types';

/** Ein Druck auf der Wunschliste. */
export interface Wish {
  gameId: string;
  printingId: string;
  /** Wie viele Exemplare gesucht werden (bisher immer 1). */
  quantity: number;
  /** Wann die Karte auf die Liste kam (ISO), neueste zuerst. */
  addedAt: string;
  /** Zielpreis in Euro: Preisalarm, sobald die Karte so viel oder weniger kostet. */
  target?: number;
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

/**
 * Preisalarm je Wunsch, nur auf diesem Gerät gemerkt (Schlüssel wishKey):
 * `ref` = Preis, mit dem verglichen wird (beim ersten Sehen bzw. beim letzten Alarm),
 * `hit` = Erreichen des Zielpreises wurde schon gemeldet (fällt weg, sobald der Preis wieder darüber liegt).
 */
export interface WishWatch {
  ref: number;
  hit?: boolean;
}
export type WishWatches = Record<string, WishWatch>;

/** target: Zielpreis erreicht; drop: ohne Zielpreis deutlich günstiger geworden (wie bei den Preiswarnungen). */
export interface WishAlert {
  key: string;
  kind: 'target' | 'drop';
  price: number;
  /** Vergleichspreis (bei drop) bzw. der Zielpreis (bei target). */
  from: number;
}

type PriceOfWish = (wish: Wish) => number | undefined;

/** Offene Preisalarme der Wunschliste. */
export function wishAlerts(wishes: Wish[], priceOf: PriceOfWish, watches: WishWatches): WishAlert[] {
  const alerts: WishAlert[] = [];
  for (const w of wishes) {
    const price = priceOf(w);
    if (price === undefined) continue;
    const key = wishKey(w);
    const watch = watches[key];
    if (w.target !== undefined) {
      if (price <= w.target && !watch?.hit) alerts.push({ key, kind: 'target', price, from: w.target });
    } else if (watch && price < watch.ref && isStrong(watch.ref, price)) {
      alerts.push({ key, kind: 'drop', price, from: watch.ref });
    }
  }
  return alerts;
}

/**
 * Merkliste nachführen: neue Wünsche bekommen ihren heutigen Preis als Vergleich, Zielpreise über dem
 * Preis werden wieder scharf, entfernte Wünsche fallen weg. Mit `seen` gelten diese Alarme als gemeldet.
 * Gibt dasselbe Objekt zurück, wenn sich nichts ändert.
 */
export function watchWishes(wishes: Wish[], priceOf: PriceOfWish, watches: WishWatches, seen: WishAlert[] = []): WishWatches {
  const next: WishWatches = {};
  let changed = false;
  const shown = new Map(seen.map((a) => [a.key, a]));
  for (const w of wishes) {
    const key = wishKey(w);
    const price = priceOf(w);
    let watch = watches[key];
    if (price !== undefined) {
      const alert = shown.get(key);
      if (!watch) watch = { ref: price };
      else if (alert) watch = { ref: price, hit: alert.kind === 'target' ? true : watch.hit };
      else if (watch.hit && (w.target === undefined || price > w.target)) watch = { ref: watch.ref };
    }
    if (watch) next[key] = watch;
    if (watch !== watches[key]) changed = true;
  }
  if (Object.keys(watches).length !== Object.keys(next).length) changed = true;
  return changed ? next : watches;
}
