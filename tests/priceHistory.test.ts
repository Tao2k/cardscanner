import { describe, expect, it } from 'vitest';
import { appendSnapshot, collectionMovers, collectionSeries, isStrong, startIndex, type PriceHistoryFile } from '../src/core/priceHistory';
import type { PriceFile, PriceEntry } from '../src/core/prices';
import type { CollectionItem, Printing } from '../src/core/types';

const snapshot = (day: string, prices: Record<string, PriceEntry>): PriceFile => ({
  gameId: 'riftbound',
  source: 'Cardmarket',
  sourceUrl: 'https://example.invalid',
  currency: 'EUR',
  asOf: `${day}T00:48:00.000Z`,
  builtAt: `${day}T04:00:00.000Z`,
  prices,
});

const item = (printingId: string, quantity = 1, extra: Partial<CollectionItem> = {}): CollectionItem => ({
  itemId: `${printingId}-${quantity}-${extra.finish ?? 'normal'}-${extra.language ?? 'en'}`,
  gameId: 'riftbound',
  printingId,
  language: 'en',
  quantity,
  condition: 'NM',
  finish: 'normal',
  location: '',
  notes: '',
  confirmed: true,
  addedAt: '',
  updatedAt: '',
  ...extra,
});

const lookup = (_g: string, id: string): Printing | undefined =>
  id === 'epic' ? { printingId: id, cardName: 'Epic', setCode: 'OGN', collectorNumber: '1', variant: 'normal', imageUrl: '', finishes: ['foil'] } : undefined;

function build(days: [string, Record<string, PriceEntry>][]): PriceHistoryFile {
  return days.reduce<PriceHistoryFile | null>((h, [d, p]) => appendSnapshot(h, snapshot(d, p)), null)!;
}

describe('Preisverlauf', () => {
  it('hängt Preisstände in Cent an und ersetzt denselben Tag', () => {
    const h = build([
      ['2026-10-20', { a: { n: 1.5, f: 4 } }],
      ['2026-10-21', { a: { n: 2 }, b: { n: 0.1 } }],
      ['2026-10-21', { a: { n: 2.5 }, b: { n: 0.1 } }],
    ]);
    expect(h.dates).toEqual(['2026-10-20', '2026-10-21']);
    expect(h.n.a).toEqual([150, 250]);
    expect(h.f.a).toEqual([400, null]);
    expect(h.n.b).toEqual([null, 10]);
  });

  it('nimmt den Tag in Berliner Zeit', () => {
    const h = appendSnapshot(null, { ...snapshot('x', { a: { n: 1 } }), asOf: '2026-10-20T23:30:00.000Z' });
    expect(h.dates).toEqual(['2026-10-21']);
  });

  it('dünnt Tage älter als 90 Tage auf einen pro Woche aus', () => {
    const days: [string, Record<string, PriceEntry>][] = [];
    for (let i = 0; i < 120; i++) days.push([new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), { a: { n: i + 1 } }]);
    const h = build(days);
    const old = h.dates.filter((d) => d < days[30][0]); // 30 ältere Tage → je Woche einer
    expect(h.dates.slice(-90)).toEqual(days.slice(-90).map((d) => d[0]));
    expect(old.length).toBeLessThanOrEqual(5);
    expect(h.n.a.length).toBe(h.dates.length);
  });

  it('rechnet den Wert der Sammlung je Tag ohne Sprung, wenn eine Karte erst später einen Preis bekommt', () => {
    const h = build([
      ['2026-10-20', { a: { n: 1 } }],
      ['2026-10-21', { a: { n: 2 } }],
      ['2026-10-22', { a: { n: 2 }, b: { n: 5 } }],
    ]);
    const series = collectionSeries([item('a', 2), item('b')], new Map([['riftbound', h]]), lookup);
    expect(series.map((p) => p.value)).toEqual([7, 9, 9]);
  });

  it('nimmt für reine Foil-Drucke den normalen Preis', () => {
    const h = build([
      ['2026-10-20', { epic: { n: 10 } }],
      ['2026-10-27', { epic: { n: 20 } }],
    ]);
    const [m] = collectionMovers([item('epic', 1, { finish: 'foil' })], new Map([['riftbound', h]]), lookup, 7);
    expect(m).toMatchObject({ from: 10, to: 20, delta: 10, pct: 1, strong: true });
  });

  it('vergleicht mit dem Stand vor dem Zeitraum und fasst gleiche Drucke zusammen', () => {
    const h = build([
      ['2026-10-01', { a: { n: 1 } }],
      ['2026-10-18', { a: { n: 2 } }],
      ['2026-10-25', { a: { n: 3 } }],
    ]);
    expect(startIndex(h.dates, 7)).toBe(1);
    expect(startIndex(h.dates, 30)).toBe(0);
    expect(startIndex(h.dates, null)).toBe(0);
    const movers = collectionMovers([item('a', 1), item('a', 2, { language: 'fr' })], new Map([['riftbound', h]]), lookup, 7);
    expect(movers).toHaveLength(1);
    expect(movers[0]).toMatchObject({ quantity: 3, from: 2, to: 3, strong: true });
    expect(movers[0].series).toEqual([2, 3]);
  });

  it('markiert nur deutliche Änderungen als stark', () => {
    expect(isStrong(0.1, 0.3)).toBe(false); // +200 %, aber nur 0,20 €
    expect(isStrong(2, 2.5)).toBe(true); // +25 %, 0,50 €
    expect(isStrong(2, 2.3)).toBe(false); // +15 %
    expect(isStrong(100, 88)).toBe(true); // −12 %, aber −12 €
    expect(isStrong(5, 3)).toBe(true);
  });
});
