import { describe, expect, it } from 'vitest';
import type { Printing } from '../src/core/types';
import { foilChoice, watchWishes, wishAlerts, wishFinish, wishKey, wishOwners, withWish, withoutWish, type Wish } from '../src/core/wishlist';

const wish = (printingId: string, addedAt = '2026-11-02T08:00:00Z'): Wish => ({ gameId: 'riftbound', printingId, quantity: 1, addedAt });
const card = (printingId: string, quantity: number, finish: 'normal' | 'foil' = 'normal') => ({ gameId: 'riftbound', printingId, finish, quantity });

describe('Wunschliste', () => {
  it('findet Freunde mit gewünschten Karten, die mit übrigen Exemplaren zuerst', () => {
    const friends = new Map([
      ['anna', [card('a', 1), card('b', 5)]],
      ['ben', [card('a', 2), card('a', 1, 'foil'), card('c', 0)]],
    ]);
    const owners = wishOwners([wish('a'), wish('c')], friends, 1);
    expect(owners.get('riftbound|a')).toEqual([
      { userId: 'ben', quantity: 3, spare: 2 },
      { userId: 'anna', quantity: 1, spare: 0 },
    ]);
    // Ohne Exemplar zählt niemand, Karten ohne Wunsch auch nicht
    expect(owners.has('riftbound|c')).toBe(false);
    expect(owners.has('riftbound|b')).toBe(false);
  });

  it('zählt bei einem Foil-Wunsch nur Foil-Exemplare der Freunde', () => {
    const friends = new Map([
      ['anna', [card('a', 3)]],
      ['ben', [card('a', 1), card('a', 2, 'foil')]],
    ]);
    const owners = wishOwners([{ ...wish('a'), quantity: 3, foil: true }], friends, 1);
    expect(owners.get('riftbound|a')).toEqual([{ userId: 'ben', quantity: 2, spare: 1 }]);
  });

  it('bietet Foil nur bei Common und Uncommon an', () => {
    const p = (rarity: string, finishes?: Printing['finishes']) => ({ rarity, finishes }) as Printing;
    expect(foilChoice(p('Common'))).toBe(true);
    expect(foilChoice(p('uncommon', ['normal', 'foil']))).toBe(true);
    expect(foilChoice(p('Common', ['normal']))).toBe(false);
    expect(foilChoice(p('Rare', ['foil']))).toBe(false);
    expect(foilChoice(p('Epic'))).toBe(false);
    expect(foilChoice(undefined)).toBe(false);
    expect(wishFinish(p('Common'), true)).toBe('foil');
    expect(wishFinish(p('Common'), false)).toBe('normal');
    expect(wishFinish(p('Rare', ['foil']))).toBe('foil');
    // Foil-Wunsch auf einer Karte ohne Foil-Wahl zählt nicht
    expect(wishFinish(p('Common', ['normal']), true)).toBe('normal');
  });

  it('setzt neue Wünsche nach oben und entfernt sie wieder', () => {
    const list = withWish([wish('a'), wish('b')], wish('b', '2026-11-03T08:00:00Z'));
    expect(list.map((w) => w.printingId)).toEqual(['b', 'a']);
    expect(withoutWish(list, wishKey(wish('a'))).map((w) => w.printingId)).toEqual(['b']);
  });
});

describe('Preisalarm der Wunschliste', () => {
  const prices = (map: Record<string, number>) => (w: Wish) => map[w.printingId];

  it('merkt neue Wünsche mit dem heutigen Preis vor und meldet dabei nichts', () => {
    const wishes = [wish('a'), wish('b')];
    const watches = watchWishes(wishes, prices({ a: 2, b: 10 }), {});
    expect(watches).toEqual({ 'riftbound|a': { ref: 2 }, 'riftbound|b': { ref: 10 } });
    expect(wishAlerts(wishes, prices({ a: 2, b: 10 }), watches)).toEqual([]);
    // Unverändert: dasselbe Objekt, damit nichts unnötig gespeichert wird
    expect(watchWishes(wishes, prices({ a: 2, b: 10 }), watches)).toBe(watches);
  });

  it('meldet ohne Zielpreis einen deutlichen Preisrückgang, einmal', () => {
    const wishes = [wish('a'), wish('b')];
    let watches = watchWishes(wishes, prices({ a: 10, b: 50 }), {});
    const now = prices({ a: 7.5, b: 48 });
    const alerts = wishAlerts(wishes, now, watches);
    expect(alerts).toEqual([{ key: 'riftbound|a', kind: 'drop', price: 7.5, from: 10 }]);
    watches = watchWishes(wishes, now, watches, alerts);
    expect(wishAlerts(wishes, now, watches)).toEqual([]);
    // Fällt sie danach noch einmal deutlich, gibt es den nächsten Hinweis
    expect(wishAlerts(wishes, prices({ a: 5, b: 48 }), watches)).toHaveLength(1);
  });

  it('meldet das Erreichen des Zielpreises und wird wieder scharf, wenn der Preis darüber steigt', () => {
    const wishes = [{ ...wish('a'), target: 4 }];
    let watches = watchWishes(wishes, prices({ a: 5 }), {});
    expect(wishAlerts(wishes, prices({ a: 4.2 }), watches)).toEqual([]);
    const alerts = wishAlerts(wishes, prices({ a: 3.9 }), watches);
    expect(alerts).toEqual([{ key: 'riftbound|a', kind: 'target', price: 3.9, from: 4 }]);
    watches = watchWishes(wishes, prices({ a: 3.9 }), watches, alerts);
    expect(wishAlerts(wishes, prices({ a: 3.5 }), watches)).toEqual([]);
    // Wieder teurer als das Ziel, dann wieder darunter: neuer Hinweis
    watches = watchWishes(wishes, prices({ a: 4.5 }), watches);
    expect(wishAlerts(wishes, prices({ a: 3.8 }), watches)).toHaveLength(1);
  });

  it('vergisst entfernte Wünsche und übergeht Karten ohne Preis', () => {
    const watches = watchWishes([wish('a'), wish('b')], prices({ a: 1, b: 2 }), {});
    expect(watchWishes([wish('b'), wish('c')], prices({ b: 2 }), watches)).toEqual({ 'riftbound|b': { ref: 2 } });
  });
});
