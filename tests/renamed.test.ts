import { describe, expect, it } from 'vitest';
import { lookupWithRenames, orphanPrinting, renamedPrinting } from '../src/core/renamed';
import type { Printing } from '../src/core/types';

const card = (printingId: string, cardName: string, setCode: string, collectorNumber: string, variant: Printing['variant'], extra: Partial<Printing> = {}): Printing => ({
  printingId,
  cardName,
  setCode,
  collectorNumber,
  variant,
  imageUrl: `https://example.invalid/${printingId}.png`,
  ...extra,
});

const printings: Printing[] = [
  card('ogn-247-298', 'Daughter of the Void', 'OGN', '247', 'normal'),
  card('dotgg-ogn-247-p', 'Daughter of the Void', 'OGNX', '247', 'promo', { externalIds: { base: 'ogn-247-298' } }),
  card('dotgg-ogn-247-mb-p', 'Daughter of the Void', 'OGNX', '247-MB', 'promo', { externalIds: { base: 'ogn-247-298' } }),
  card('ogn-255-298', 'Ahri, Nine-Tailed Fox', 'OGN', '255', 'normal'),
  // dotgg führt die K/DA-Promos seit dem 21.11.2026 als eigenes Set
  card('dotgg-kda-001-p', 'Ahri, Nine-Tailed Fox', 'KDA', '001', 'promo'),
  card('dotgg-kda-003-p', 'Daughter of the Void', 'KDA', '003', 'promo'),
];

describe('umbenannte Promokarten', () => {
  it('findet zur alten K/DA-ID den neuen Druck', () => {
    expect(renamedPrinting('dotgg-ogn-247-kda-p', printings)?.printingId).toBe('dotgg-kda-003-p');
    expect(renamedPrinting('dotgg-ogn-255-kda-p', printings)?.printingId).toBe('dotgg-kda-001-p');
  });

  it('rät nicht, wenn nichts oder mehreres passt', () => {
    expect(renamedPrinting('dotgg-ogn-247-xyz-p', printings)).toBeUndefined();
    expect(renamedPrinting('dotgg-ogn-247-p', printings)).toBeUndefined();
    const twice = [...printings, card('dotgg-kda-103-p', 'Daughter of the Void', 'KDA', '103', 'promo')];
    expect(renamedPrinting('dotgg-ogn-247-kda-p', twice)).toBeUndefined();
  });

  it('zeigt sonst die Grundkarte bei ihren Promos', () => {
    const p = orphanPrinting('dotgg-ogn-247-xyz-p', printings);
    expect(p).toMatchObject({ printingId: 'dotgg-ogn-247-xyz-p', cardName: 'Daughter of the Void', setCode: 'OGNX', collectorNumber: '247-XYZ', variant: 'promo' });
    expect(orphanPrinting('ganz-unbekannt', printings)).toBeUndefined();
  });

  it('Katalogsuche nimmt bekannte IDs unverändert', () => {
    const lookup = lookupWithRenames(new Map(printings.map((p) => [p.printingId, p])), printings);
    expect(lookup('dotgg-ogn-247-p')?.printingId).toBe('dotgg-ogn-247-p');
    expect(lookup('dotgg-ogn-247-kda-p')?.cardName).toBe('Daughter of the Void');
    expect(lookup('dotgg-ogn-247-kda-p')?.setCode).toBe('KDA');
  });
});
