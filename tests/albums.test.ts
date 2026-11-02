import { describe, expect, it } from 'vitest';
import { albumBinder, buildBinders, splitKey } from '../src/app/binder';
import { albumName, MAX_ALBUM_NAME, sortAlbums, withCard, withoutCard, type Album } from '../src/core/albums';
import { HIGHLIGHT_FOLDER, isHighlight } from '../src/core/folders';
import type { CardSet, Printing, Variant } from '../src/core/types';

const card = (setCode: string, collectorNumber: string, rarity?: string, variant: Variant = 'normal'): Printing => ({
  printingId: `${setCode}-${collectorNumber}`,
  cardName: `Card ${setCode} ${collectorNumber}`,
  setCode,
  collectorNumber,
  variant,
  rarity,
  imageUrl: `https://example.invalid/${setCode}-${collectorNumber}.png`,
});
const own = (printingId: string, quantity = 1) => ({ gameId: 'riftbound', printingId, quantity, finish: 'foil' as const });

const printings = [
  card('SFD', '3', 'Epic'),
  card('OGN', '1', 'Common'),
  card('OGN', '2', 'Rare'),
  card('OGN', '300', 'Showcase', 'overnumbered'),
  card('OGN', '4a', 'Uncommon', 'alt_art'),
  card('SFD', '1', 'Uncommon'),
  card('OGNX', '1', 'Rare', 'promo'),
];
const byGame = new Map([['riftbound', new Map(printings.map((p) => [p.printingId, p]))]]);
const sets = new Map<string, CardSet[]>([
  [
    'riftbound',
    [
      { setId: 'ogn', code: 'OGN', name: 'Origins', releaseDate: '2025-10-31' },
      { setId: 'ognx', code: 'OGNX', name: 'Origins Promos', releaseDate: '2025-10-31', promo: true },
      { setId: 'sfd', code: 'SFD', name: 'Spiritforged', releaseDate: '2026-02-13' },
    ],
  ],
]);

describe('Gesamtordner', () => {
  it('erkennt Rare, Epic und Showcase, aber keine Promos', () => {
    expect(isHighlight(card('OGN', '1', 'Rare'))).toBe(true);
    expect(isHighlight(card('OGN', '1', 'epic'))).toBe(true);
    expect(isHighlight(card('OGN', '1', 'Common'))).toBe(false);
    expect(isHighlight(card('OGN', '1', 'Common', 'signature'))).toBe(true);
    expect(isHighlight(card('OGNX', '1', 'Rare', 'promo'))).toBe(false);
    expect(isHighlight(card('T1', '1', 'Rare'), { setId: 't1', code: 'T1', name: 'T1', promo: true })).toBe(false);
  });

  it('steht hinter Sets und Promos und sammelt setübergreifend nach Set und Nummer', () => {
    const binders = buildBinders(['riftbound'], byGame, sets, [own('OGN-2', 2), own('SFD-1')]);
    expect(binders.map((b) => b.code)).toEqual(['OGN', 'SFD', 'PROMO', HIGHLIGHT_FOLDER]);
    const all = binders.at(-1)!;
    expect(all.mixed).toBe(true);
    expect(all.slots.map((s) => s.printing.printingId)).toEqual(['OGN-2', 'OGN-4a', 'OGN-300', 'SFD-3']);
    expect(all.owned).toBe(1);
    expect(all.slots[0].quantity).toBe(2);
  });

  it('fehlt, wenn ein Spiel keine seltenen Karten kennt', () => {
    const plain = new Map([['riftbound', new Map([[printings[1].printingId, printings[1]]])]]);
    expect(buildBinders(['riftbound'], plain, sets, []).map((b) => b.code)).toEqual(['OGN']);
  });
});

describe('Eigene Alben', () => {
  const album: Album = { id: 'a1', name: 'Lieblinge', cards: [], createdAt: '2026-11-02T10:00:00Z', updatedAt: '' };

  it('nimmt jede Karte nur einmal auf und behält die Reihenfolge', () => {
    let a = withCard(album, 'riftbound|SFD-3');
    a = withCard(a, 'riftbound|OGN-1');
    expect(withCard(a, 'riftbound|SFD-3')).toBe(a);
    expect(a.cards).toEqual(['riftbound|SFD-3', 'riftbound|OGN-1']);
    expect(withoutCard(a, 'riftbound|SFD-3').cards).toEqual(['riftbound|OGN-1']);
    expect(withoutCard(a, 'riftbound|XYZ')).toBe(a);
  });

  it('bereinigt Namen', () => {
    expect(albumName('  Rote   Karten ')).toBe('Rote Karten');
    expect(albumName('x'.repeat(80))).toHaveLength(MAX_ALBUM_NAME);
    expect(albumName('   ')).toBe('');
  });

  it('sortiert Alben nach Erstellen', () => {
    const b = { ...album, id: 'b', createdAt: '2026-11-01T00:00:00Z' };
    expect(sortAlbums([album, b]).map((a) => a.id)).toEqual(['b', 'a1']);
  });

  it('wird zum Binder in Album-Reihenfolge, mit eigener Anzahl; Unbekanntes fällt weg', () => {
    const a = { ...album, cards: ['riftbound|SFD-3', 'riftbound|gibt-es-nicht', 'riftbound|OGN-1'] };
    const binder = albumBinder(a, byGame, [own('OGN-1', 3)], 'riftbound');
    expect(binder.key).toBe('riftbound|album:a1');
    expect(binder.album).toBe('a1');
    expect(binder.name).toBe('Lieblinge');
    expect(binder.slots.map((s) => [s.printing.printingId, s.quantity])).toEqual([
      ['SFD-3', 0],
      ['OGN-1', 3],
    ]);
    expect(binder.owned).toBe(1);
  });

  it('leeres Album bekommt das gewählte Spiel', () => {
    expect(albumBinder(album, byGame, [], 'riftbound').slots).toEqual([]);
    expect(albumBinder(album, byGame, [], 'riftbound').gameId).toBe('riftbound');
  });

  it('zerlegt Schlüssel am ersten Strich', () => {
    expect(splitKey('riftbound|dotgg-1|x')).toEqual(['riftbound', 'dotgg-1|x']);
  });
});
