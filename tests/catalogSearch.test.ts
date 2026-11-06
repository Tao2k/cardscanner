import { describe, expect, it } from 'vitest';
import { searchCatalog } from '../src/core/catalog';
import type { Printing } from '../src/core/types';

const card = (printingId: string, cardName: string, setCode: string, collectorNumber: string, extra: Partial<Printing> = {}): Printing => ({
  printingId,
  cardName,
  setCode,
  collectorNumber,
  variant: 'standard' as Printing['variant'],
  imageUrl: '',
  ...extra,
});

const catalog = [
  card('a', 'Jinx, Loose Cannon', 'OGN', '042'),
  card('b', 'Jinx, Rebel', 'OGN', '142', { names: { fr: 'Jinx, Rebelle' } }),
  card('c', 'Annie, Fiery', 'SFD', '042a', { finishes: ['foil'] }),
  card('d', 'Teemo', 'OGS', '007'),
];

describe('Katalogsuche zum Hinzufügen', () => {
  it('findet nach Name, auch übersetzt, ohne Groß- und Kleinschreibung', () => {
    expect(searchCatalog(catalog, 'jinx').map((p) => p.printingId)).toEqual(['a', 'b']);
    expect(searchCatalog(catalog, 'rebelle').map((p) => p.printingId)).toEqual(['b']);
  });

  it('versteht Set und Nummer, mit oder ohne führende Nullen', () => {
    expect(searchCatalog(catalog, 'OGN 42').map((p) => p.printingId)).toEqual(['a']);
    expect(searchCatalog(catalog, 'ogn-042').map((p) => p.printingId)).toEqual(['a']);
    expect(searchCatalog(catalog, '42').map((p) => p.printingId)).toEqual(['a', 'c']);
    expect(searchCatalog(catalog, '7').map((p) => p.printingId)).toEqual(['d']);
  });

  it('zeigt bei leerer Suche nichts und begrenzt die Treffer', () => {
    expect(searchCatalog(catalog, '  ')).toEqual([]);
    expect(searchCatalog(catalog, 'n', 2)).toHaveLength(2);
  });
});
