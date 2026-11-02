import { describe, expect, it } from 'vitest';
import { wishKey, wishOwners, withWish, withoutWish, type Wish } from '../src/core/wishlist';

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

  it('setzt neue Wünsche nach oben und entfernt sie wieder', () => {
    const list = withWish([wish('a'), wish('b')], wish('b', '2026-11-03T08:00:00Z'));
    expect(list.map((w) => w.printingId)).toEqual(['b', 'a']);
    expect(withoutWish(list, wishKey(wish('a'))).map((w) => w.printingId)).toEqual(['b']);
  });
});
