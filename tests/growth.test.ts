import { describe, expect, it } from 'vitest';
import { growthChart } from '../src/core/priceHistory';
import type { CollectionItem } from '../src/core/types';

const item = (printingId: string, addedAt: string, quantity = 1): CollectionItem => ({
  itemId: `${printingId}-${addedAt}`,
  gameId: 'riftbound',
  printingId,
  language: 'en',
  quantity,
  condition: 'NM',
  finish: 'normal',
  location: '',
  notes: '',
  confirmed: true,
  addedAt,
  updatedAt: addedAt,
});

const prices: Record<string, number> = { a: 1, b: 10, c: 0.5 };
const price = (i: CollectionItem) => prices[i.printingId];

describe('growthChart', () => {
  const items = [item('a', '2026-10-01T10:00:00Z', 2), item('b', '2026-10-10T10:00:00Z'), item('c', '2026-10-20T10:00:00Z'), item('x', '2026-10-20T11:00:00Z')];

  it('steigt mit jeder neuen Karte zum heutigen Preis, ab 0 €', () => {
    const g = growthChart(items, price, '2026-10-31', null);
    expect(g.points).toEqual([
      { date: '2026-09-30', value: 0 },
      { date: '2026-10-01', value: 2 },
      { date: '2026-10-10', value: 12 },
      { date: '2026-10-20', value: 12.5 },
      { date: '2026-10-31', value: 12.5 },
    ]);
    expect(g.added).toBe(12.5);
    expect(g.cards).toBe(5);
  });

  it('beginnt beim Stand am Anfang des Zeitraums und zählt nur neue Karten', () => {
    const g = growthChart(items, price, '2026-10-31', 7 + 7);
    expect(g.points[0]).toEqual({ date: '2026-10-17', value: 12 });
    expect(g.added).toBe(0.5);
    expect(g.cards).toBe(2);
  });

  it('bleibt flach ohne neue Karten', () => {
    const g = growthChart(items, price, '2026-10-31', 7);
    expect(g.points).toEqual([
      { date: '2026-10-24', value: 12.5 },
      { date: '2026-10-31', value: 12.5 },
    ]);
    expect(g.cards).toBe(0);
  });

  it('ist leer ohne Karten', () => {
    expect(growthChart([], price, '2026-10-31', 30).points).toEqual([]);
  });
});
