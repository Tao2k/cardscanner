import { describe, expect, it } from 'vitest';
import { completeCatalog, splitDotggId } from '../scripts/adapters/riftbound-missing';
import { deckPool } from '../src/core/deck';
import type { CardSet, Printing } from '../src/core/types';
import type { DotggRow } from '../scripts/adapters/riftbound-promos';

const sets: CardSet[] = [
  { setId: 'RAD', code: 'RAD', name: 'Radiance' },
  { setId: 'SFD', code: 'SFD', name: 'Spiritforged' },
  { setId: 'RADX', code: 'RADX', name: 'Radiance Promos', promo: true },
];
const card = (over: Partial<Printing>): Printing => ({
  printingId: 'x',
  cardName: 'X',
  setCode: 'RAD',
  collectorNumber: '001',
  variant: 'normal',
  finishes: ['normal', 'foil'],
  texts: { en: 'X' },
  imageUrl: 'https://example.invalid/x.png',
  attributes: { orientation: 'portrait', domains: ['Calm'], supertypes: [], tags: [] },
  ...over,
});
const aphelios = card({
  printingId: 'rad-179-167',
  cardName: 'Aphelios',
  collectorNumber: '179',
  variant: 'overnumbered',
  type: 'Unit',
  texts: { en: 'Aphelios When you attach …' },
  attributes: { orientation: 'portrait', energy: 4, domains: ['Calm'], supertypes: ['Champion'], tags: ['Aphelios'], subtitle: 'Exalted' },
});
// Galerie-Karte ohne Kartentyp (z. B. Fanfare aus Radiance)
const fanfare = card({ printingId: 'rad-047-167', cardName: 'Fanfare', collectorNumber: '047', attributes: { orientation: 'portrait', energy: null, domains: ['Mind'] } });
const legend = card({ printingId: 'rad-200', cardName: 'Viktor', collectorNumber: '200', type: 'Legend', attributes: { orientation: 'portrait', domains: ['Mind', 'Calm'], supertypes: [], tags: ['Viktor'] } });

const row = (id: string, name: string, extra: DotggRow = {}): DotggRow => ({
  id,
  name,
  name_normal: name,
  set_name: 'Radiance',
  promo: '0',
  image: `https://static.dotgg.gg/riftbound/cards/${id}.webp`,
  hasNormal: '0',
  hasFoil: '1',
  rarity: 'Showcase',
  effect: 'null',
  ...extra,
});
const rows: DotggRow[] = [
  row('RAD-179', 'Aphelios - Exalted', { type: ['Unit'] }),
  row('RAD-179-STAR', 'Aphelios - Exalted', { type: ['Unit'], supertype: 'Champion', color: ['Calm'] }),
  row('RAD-047', 'Fanfare', { type: ['Spell'], color: ['Mind'], cost: '3', supertype: '', rarity: 'Common' }),
  row('SFD-R04', 'Body Rune', { set_name: 'Spiritforged', type: ['Rune'], color: ['Body'], supertype: 'Basic', hasNormal: '1', hasFoil: '0', rarity: 'Common' }),
  row('SFD-R04a', 'Body Rune', { set_name: 'Spiritforged', type: ['Rune'], color: ['Body'], supertype: 'Basic' }),
  row('RAD-T01', 'Bird // Bomb', { type: ['Unit'], supertype: 'Token', color: ['Colorless'], hasNormal: '1', hasFoil: '0' }),
  row('RAD-047-P', 'Fanfare (Promo)', { promo: '1' }),
];

describe('Karten, die in Riots Galerie fehlen', () => {
  const { printings, added, repaired } = completeCatalog(rows, sets, [aphelios, fanfare, legend], new Map([['RAD', 167]]));

  it('zerlegt dotgg-Nummern wie die Galerie', () => {
    expect(splitDotggId('RAD-179-STAR')).toEqual({ setCode: 'RAD', number: '179*' });
    expect(splitDotggId('SFD-R04a')).toEqual({ setCode: 'SFD', number: 'R04a' });
  });

  it('ergänzt Signatures, Set-Runen und Spielmarken im normalen Set, nicht doppelt und ohne Promos', () => {
    expect(added.map((p) => [p.setCode, p.collectorNumber, p.variant])).toEqual([
      ['RAD', '179*', 'signature'],
      ['SFD', 'R04', 'normal'],
      ['SFD', 'R04a', 'alt_art'],
      ['RAD', 'T01', 'normal'],
    ]);
    expect(printings).toHaveLength(3 + 4);
  });

  it('übernimmt bei Signatures Name und Werte der Grundkarte', () => {
    expect(added[0]).toMatchObject({
      printingId: 'dotgg-rad-179-star',
      cardName: 'Aphelios',
      type: 'Unit',
      finishes: ['foil'],
      texts: aphelios.texts,
      attributes: { subtitle: 'Exalted', tags: ['Aphelios'] },
      externalIds: { dotgg: 'RAD-179-STAR', base: 'rad-179-167' },
    });
    expect(added[1]).toMatchObject({ cardName: 'Body Rune', type: 'Rune', finishes: ['normal'], attributes: { domains: ['Body'], supertypes: ['Basic'] } });
  });

  it('trägt fehlende Kartentypen nach, damit die Karte im Deckbau erscheint', () => {
    expect(repaired).toEqual(['rad-047-167']);
    expect(printings.find((p) => p.printingId === 'rad-047-167')).toMatchObject({ type: 'Spell', attributes: { energy: 3, domains: ['Mind'] } });
    const pool = deckPool('riftbound', printings, sets);
    expect(pool.cards.get('Fanfare')?.kind).toBe('spell');
    // Spielmarken gehören in kein Deck, die Signature zählt als dieselbe Karte wie der normale Druck
    expect([...pool.cards.keys()].some((k) => k.startsWith('Bird'))).toBe(false);
    expect(pool.cards.get('Aphelios, Exalted')?.printing.printingId).toBe('rad-179-167');
  });
});

describe('Kartenart', () => {
  it('erkennt übersetzte Typen aus der französischen Galerie', async () => {
    const { kindOf } = await import('../src/core/deck');
    expect(kindOf(card({ type: 'Unité (Unit)' }))).toBe('unit');
    expect(kindOf(card({ type: 'Spell' }))).toBe('spell');
    expect(kindOf(card({ type: undefined }))).toBeUndefined();
  });
});
