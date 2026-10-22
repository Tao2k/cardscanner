import { describe, expect, it } from 'vitest';
import { dotggKey, guideEntry, isoTime, matchPrices, nameKey, parseDotgg, type CmProduct, type GuideRow } from '../scripts/adapters/riftbound-prices';
import { collectionValue, priceFor } from '../src/core/prices';
import type { CollectionItem, Printing } from '../src/core/types';

const printing = (setCode: string, collectorNumber: string, cardName: string, extra: Partial<Printing> = {}): Printing => ({
  printingId: `${setCode}-${collectorNumber}`.toLowerCase(),
  cardName,
  setCode,
  collectorNumber,
  variant: 'normal',
  imageUrl: 'https://example.invalid/x.png',
  ...extra,
});

describe('Cardmarket-Zuordnung', () => {
  it('bildet die dotgg-Nummer aus Set und Sammlernummer', () => {
    expect(dotggKey({ setCode: 'OGN', collectorNumber: '66' })).toBe('ogn-066');
    expect(dotggKey({ setCode: 'OGN', collectorNumber: '066a' })).toBe('ogn-066a');
    expect(dotggKey({ setCode: 'VEN', collectorNumber: '021A' })).toBe('ven-021a');
    expect(dotggKey({ setCode: 'OGN', collectorNumber: '303*' })).toBe('ogn-303-star');
    expect(dotggKey({ setCode: 'VEN', collectorNumber: 'SP3' })).toBe('ven-sp3');
  });

  it('vergleicht Namen ohne Satzzeichen und Klammerzusätze', () => {
    expect(nameKey('Ahri - Alluring')).toBe(nameKey('Ahri, Alluring'));
    expect(nameKey('Ahri - Alluring (Origins Launch Event Promo)')).toBe(nameKey('Ahri, Alluring'));
    expect(nameKey('Kai’Sa')).toBe(nameKey("Kai'Sa"));
  });

  it('liest die positionsbasierte dotgg-Liste', () => {
    const cards = parseDotgg({
      names: ['id', 'slug', 'name', 'cmurl', 'cmid'],
      data: [
        ['OGN-066', 'x', 'Ahri - Alluring', 'https://www.cardmarket.com/x', '847186'],
        ['RAD-038', 'y', 'Ahri - Confident', null, null],
      ],
    });
    expect(cards).toEqual([
      { id: 'OGN-066', name: 'Ahri - Alluring', cmid: 847186, cmurl: 'https://www.cardmarket.com/x' },
      { id: 'RAD-038', name: 'Ahri - Confident' },
    ]);
  });

  it('nimmt den Trendpreis, sonst Durchschnitte, nie den Tiefstpreis', () => {
    expect(guideEntry({ idProduct: 1, trend: 2.5, avg7: 3, low: 0.1, 'trend-foil': 0, 'avg7-foil': 4 })).toEqual({ n: 2.5, f: 4 });
    expect(guideEntry({ idProduct: 1, trend: null, avg7: null, avg30: 1.2 })).toEqual({ n: 1.2 });
    expect(guideEntry({ idProduct: 1, low: 0.5 })).toBeUndefined();
  });

  it('wandelt Cardmarkets Zeitangabe in ISO um', () => {
    expect(isoTime('2026-10-21T02:48:35+0200')).toBe('2026-10-21T00:48:35.000Z');
  });

  it('ordnet über dotgg zu, prüft Namen und fällt auf eindeutige Namen im Set zurück', () => {
    const printings = [
      printing('OGN', '066', 'Ahri, Alluring'),
      printing('OGN', '066a', 'Ahri, Alluring', { variant: 'alt_art' }),
      printing('OGN', '179', 'Acceptable Losses'),
      printing('OGN', '001', 'Blazing Scorcher'),
      printing('OGN', '002', 'Fury Rune'),
      printing('SFD', '001', 'Against the Odds'),
    ];
    const dotgg = [
      { id: 'OGN-066', name: 'Ahri - Alluring', cmid: 847186, cmurl: 'https://www.cardmarket.com/ahri' },
      { id: 'OGN-066a', name: 'Ahri - Alluring', cmid: 847187 },
      // falscher Name: verworfen
      { id: 'OGN-179', name: 'Something Else', cmid: 847346 },
      // Produkt fehlt im Cardmarket-Katalog: verworfen
      { id: 'SFD-001', name: 'Against the Odds', cmid: 999999 },
    ];
    const products: CmProduct[] = [
      { idProduct: 847186, name: 'Ahri, Alluring', idExpansion: 6286 },
      { idProduct: 847187, name: 'Ahri, Alluring', idExpansion: 6286 },
      { idProduct: 847346, name: 'Acceptable Losses', idExpansion: 6286 },
      { idProduct: 845712, name: 'Blazing Scorcher', idExpansion: 6286 },
      // zwei Produkte gleichen Namens: nicht eindeutig, kein Preis
      { idProduct: 845886, name: 'Fury Rune', idExpansion: 6286 },
      { idProduct: 845887, name: 'Fury Rune', idExpansion: 6286 },
    ];
    const guide: GuideRow[] = [
      { idProduct: 847186, trend: 1.5, 'trend-foil': 4 },
      { idProduct: 847187, trend: 20 },
      { idProduct: 847346, trend: 9 },
      { idProduct: 845712, trend: 0.05 },
      { idProduct: 845886, trend: 0.02 },
    ];
    const { prices, report } = matchPrices(printings, dotgg, products, guide);
    expect(prices).toEqual({
      'ogn-066': { n: 1.5, f: 4, url: 'https://www.cardmarket.com/ahri' },
      'ogn-066a': { n: 20 },
      // „Acceptable Losses“ hat einen eindeutigen Namen im Set und kommt über den Rückfall
      'ogn-179': { n: 9 },
      'ogn-001': { n: 0.05 },
    });
    expect(report).toMatchObject({ printings: 6, linked: 4, priced: 4, byName: 2 });
    expect(report.rejected).toHaveLength(2);
  });
});

describe('Preise in der App', () => {
  const item = (finish: 'normal' | 'foil', quantity = 1): CollectionItem => ({
    itemId: 'i',
    gameId: 'riftbound',
    printingId: 'p',
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

  it('nimmt für reine Foil-Drucke den normalen Marktpreis von Cardmarket', () => {
    const epic = printing('OGN', '119', 'Ahri, Inquisitive', { finishes: ['foil'] });
    const common = printing('OGN', '001', 'Blazing Scorcher', { finishes: ['normal', 'foil'] });
    expect(priceFor({ n: 8, f: 3.4 }, 'foil', epic)).toBe(8);
    expect(priceFor({ f: 3.4 }, 'foil', epic)).toBe(3.4);
    expect(priceFor({ n: 0.05, f: 0.3 }, 'foil', common)).toBe(0.3);
    expect(priceFor({ n: 0.05 }, 'foil', common)).toBeUndefined();
    expect(priceFor({ n: 0.05, f: 0.3 }, 'normal', common)).toBe(0.05);
  });

  it('summiert den Sammlungswert und zählt Karten ohne Preis', () => {
    const items = [item('normal', 3), { ...item('foil', 2), printingId: 'q' }];
    const value = collectionValue(items, (_, id) => (id === 'p' ? { n: 0.1 } : undefined), () => undefined);
    expect(value).toEqual({ total: 0.3, unpriced: 2 });
  });
});
