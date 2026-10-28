import { describe, expect, it } from 'vitest';
import { tradeBetween } from '../src/core/friends';

const card = (printingId: string, quantity: number, finish: 'normal' | 'foil' = 'normal') => ({ gameId: 'riftbound', printingId, finish, quantity });

describe('Freunde-Abgleich', () => {
  it('findet Karten, die eine Seite doppelt hat und der anderen fehlen', () => {
    const mine = [card('a', 3), card('b', 1), card('c', 2)];
    const friend = [card('b', 4), card('d', 2), card('e', 1)];
    const trade = tradeBetween(mine, friend);
    expect(trade.get.map((c) => [c.printingId, c.spare])).toEqual([['d', 1]]);
    expect(trade.give.map((c) => [c.printingId, c.spare])).toEqual([
      ['a', 2],
      ['c', 1],
    ]);
  });

  it('zählt Sprachen, Ausführungen und Zustände eines Drucks zusammen', () => {
    const mine = [card('a', 1), card('a', 1, 'foil'), card('a', 1, 'foil')];
    const trade = tradeBetween(mine, []);
    expect(trade.give).toEqual([{ gameId: 'riftbound', printingId: 'a', spare: 2, finish: 'foil' }]);
  });

  it('behält auf Wunsch mehr Exemplare', () => {
    const trade = tradeBetween([card('a', 3)], [], 3);
    expect(trade.give).toEqual([]);
  });

  it('ignoriert Einträge ohne Anzahl', () => {
    const trade = tradeBetween([card('a', 0)], [card('a', 2)]);
    expect(trade.get.map((c) => c.printingId)).toEqual(['a']);
  });
});
