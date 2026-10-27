import { describe, expect, it } from 'vitest';
import { buildBinders, pages, withoutFirst, withoutLast } from '../src/app/binder';
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
    expect(binders.map((b) => [b.key, b.name])).toEqual([
      ['riftbound|OGN', 'Origins'],
      ['riftbound|SFD', 'Spiritforged'],
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
