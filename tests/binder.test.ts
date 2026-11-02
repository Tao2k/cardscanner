import { describe, expect, it } from 'vitest';
import { buildBinders, flightPace, flightStops, pages, withoutFirst, withoutLast } from '../src/app/binder';
import type { CardSet, CollectionItem, Printing } from '../src/core/types';

const card = (setCode: string, collectorNumber: string): Printing => ({
  printingId: `${setCode}-${collectorNumber}`,
  cardName: `Card ${collectorNumber}`,
  setCode,
  collectorNumber,
  variant: 'normal',
  imageUrl: `https://example.invalid/${setCode}-${collectorNumber}.png`,
});
const own = (printingId: string, quantity: number, finish: 'normal' | 'foil' = 'normal'): CollectionItem => ({
  itemId: `${printingId}-${finish}-${quantity}`,
  gameId: 'riftbound',
  printingId,
  language: 'en',
  quantity,
  condition: 'NM',
  finish,
  location: '',
  notes: '',
  confirmed: true,
  addedAt: '',
  updatedAt: '',
});

const printings = [card('SFD', '2'), card('OGN', '10'), card('OGN', '2'), card('OGN', '2a'), card('SFD', '1'), card('OGN', '1')];
const byGame = new Map([['riftbound', new Map(printings.map((p) => [p.printingId, p]))]]);
// Katalogreihenfolge alphabetisch, Erscheinen entscheidet
const sets = new Map<string, CardSet[]>([
  [
    'riftbound',
    [
      { setId: 'sfd', code: 'SFD', name: 'Spiritforged', releaseDate: '2026-02-13' },
      { setId: 'ogn', code: 'OGN', name: 'Origins', releaseDate: '2025-10-31' },
    ],
  ],
]);

describe('Binder', () => {
  it('hat je Set einen Binder in Erscheinungsreihenfolge, Plätze nach Sammlernummer', () => {
    const binders = buildBinders(['riftbound'], byGame, sets, []);
    expect(binders.map((b) => [b.key, b.code, b.name])).toEqual([
      ['riftbound|OGN', 'OGN', 'Origins'],
      ['riftbound|SFD', 'SFD', 'Spiritforged'],
    ]);
    expect(binders[0].slots.map((s) => s.printing.collectorNumber)).toEqual(['1', '2', '2a', '10']);
    expect(binders[0].owned).toBe(0);
  });

  it('zählt Exemplare eines Drucks über Ausführungen zusammen', () => {
    const [ogn] = buildBinders(['riftbound'], byGame, sets, [own('OGN-2', 2), own('OGN-2', 1, 'foil'), own('OGN-10', 1)]);
    const slot = ogn.slots.find((s) => s.key === 'riftbound|OGN-2')!;
    expect(slot.quantity).toBe(3);
    expect(slot.foil).toBe(true);
    expect(ogn.owned).toBe(2);
  });

  it('fasst alle Promo-Sets in einem Binder hinter den normalen Sets zusammen', () => {
    const promos = [card('SFDX', '7'), card('T1', '001'), card('OGNX', '066'), card('OGNX', '001')];
    const all = new Map([['riftbound', new Map([...printings, ...promos].map((p) => [p.printingId, p]))]]);
    const withPromos = new Map<string, CardSet[]>([
      [
        'riftbound',
        [
          ...sets.get('riftbound')!,
          { setId: 'OGNX', code: 'OGNX', name: 'Origins Promos', releaseDate: '2025-10-31', promo: true },
          { setId: 'SFDX', code: 'SFDX', name: 'Spiritforged Promos', releaseDate: '2026-02-13', promo: true },
          { setId: 'T1', code: 'T1', name: 'T1 2025 Worlds Champion Collection', promo: true },
        ],
      ],
    ]);
    const binders = buildBinders(['riftbound'], all, withPromos, [own('T1-001', 1)]);
    expect(binders.map((b) => [b.key, b.name, b.mixed])).toEqual([
      ['riftbound|OGN', 'Origins', false],
      ['riftbound|SFD', 'Spiritforged', false],
      ['riftbound|PROMO', 'Promos', true],
    ]);
    // nach Set (Erscheinen, ohne Datum zuletzt), dann nach Nummer
    expect(binders[2].slots.map((s) => s.printing.printingId)).toEqual(['OGNX-001', 'OGNX-066', 'SFDX-7', 'T1-001']);
    expect(binders[2].owned).toBe(1);
  });

  it('teilt in Seiten zu 9 Plätzen', () => {
    expect(pages([...Array(20).keys()]).map((p) => p.length)).toEqual([9, 9, 2]);
    expect(pages([])).toEqual([]);
  });

  it('nimmt beim Rückgängig das letzte, beim Landen das erste Vorkommen', () => {
    expect(withoutLast(['a', 'b', 'a'], 'a')).toEqual(['a', 'b']);
    expect(withoutFirst(['a', 'b', 'a'], 'a')).toEqual(['b', 'a']);
    expect(withoutLast(['a'], 'x')).toEqual(['a']);
  });
});

describe('Einfliegen neuer Karten', () => {
  // Wie bei Yalisa: einige Origins, dann viele Spiritforged über Seite 8 hinaus und noch Karten aus dem nächsten Set
  const at = new Map<string, { binder: string; at: number }>();
  const queue: string[] = [];
  const add = (binder: string, slots: number[]) =>
    slots.forEach((n) => {
      const key = `${binder}-${n}`;
      at.set(key, { binder, at: n });
      queue.push(key);
    });
  add('UNL', [3, 40]);
  add('SFD', Array.from({ length: 45 }, (_, i) => i * 5));
  add('OGN', [80, 2, 30]);
  queue.push('unbekannt');
  const stops = flightStops(queue, ['OGN', 'SFD', 'UNL'], (k) => at.get(k));

  it('lässt jede neue Karte einfliegen, auch nach mehr als 40 Karten', () => {
    const flown = stops.flatMap((s) => s.keys);
    expect(flown).toHaveLength(50);
    expect(new Set(flown)).toEqual(new Set(queue.filter((k) => k !== 'unbekannt')));
    // Hört nicht mitten in Spiritforged auf: der letzte Halt ist die letzte Seite des letzten Sets
    expect(stops.at(-1)).toEqual({ binder: 'UNL', page: 4, keys: ['UNL-40'] });
  });

  it('blättert nur vorwärts, Binder für Binder und Seite für Seite', () => {
    expect(stops[0]).toEqual({ binder: 'OGN', page: 0, keys: ['OGN-2'] });
    const order = stops.map((s) => ['OGN', 'SFD', 'UNL'].indexOf(s.binder) * 1000 + s.page);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    expect(stops.find((s) => s.binder === 'SFD' && s.page === 7)?.keys).toEqual(['SFD-65', 'SFD-70']);
  });

  it('wird bei vielen Karten schneller, bleibt aber sichtbar', () => {
    const few = flightPace(5, 2);
    const many = flightPace(200, 60);
    expect(few).toEqual({ duration: 810, gap: 495, turn: 380 });
    expect(many.duration).toBeLessThan(few.duration);
    expect(many.gap).toBeLessThan(few.gap);
    expect(many.turn).toBeLessThan(few.turn);
    expect(many).toEqual({ duration: 420, gap: 90, turn: 220 });
  });
});
