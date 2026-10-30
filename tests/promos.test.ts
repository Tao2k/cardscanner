import { describe, expect, it } from 'vitest';
import { groupBySet } from '../src/app/SetList';
import { folderIndex } from '../src/core/folders';
import type { CardSet, Printing } from '../src/core/types';
import { promoCatalog, promoEvent, splitPromoId, type DotggRow } from '../scripts/adapters/riftbound-promos';
import { matchPrices } from '../scripts/adapters/riftbound-prices';

const sets: CardSet[] = [
  { setId: 'OGN', code: 'OGN', name: 'Origins', releaseDate: '2025-10-31' },
  { setId: 'SFD', code: 'SFD', name: 'Spiritforged', releaseDate: '2026-02-13' },
];
const ahri: Printing = {
  printingId: 'ogn-066-298',
  cardName: 'Ahri',
  setCode: 'OGN',
  collectorNumber: '066',
  variant: 'normal',
  finishes: ['normal', 'foil'],
  texts: { en: 'Ahri When I attack, ...' },
  imageUrl: 'https://example.invalid/ahri.png',
  attributes: { orientation: 'portrait' },
};
const rune: Printing = { ...ahri, printingId: 'ogn-126-298', cardName: 'Body Rune', collectorNumber: '126', texts: { en: 'Body Rune' } };
const row = (id: string, name: string, set_name: string, extra: DotggRow = {}): DotggRow => ({
  id,
  name,
  name_normal: name.replace(/\s*\([^)]*\)$/, ''),
  set_name,
  promo: '1',
  image: `https://static.dotgg.gg/riftbound/cards/${id}.webp`,
  hasNormal: '0',
  hasFoil: '1',
  rarity: 'Showcase',
  effect: 'Some <br />text :rb_might:',
  ...extra,
});
const rows = [
  row('OGN-066-P', 'Ahri - Alluring (Origins Launch Event Promo)', 'Origins', { cmid: '900' }),
  row('OGN-126b', 'Body Rune (Origins Nexus Night Promo)', 'Origins'),
  row('T1A-001-P', 'Ambessa - The Wolf (T1 Worlds Player Bundle - Doran)', 'T1 2025 Worlds Champion Collection'),
  row('T1S-001-P', 'Ambessa - The Wolf (T1 Worlds Signature - Doran)', 'T1 2025 Worlds Champion Collection'),
  { ...row('OGN-066', 'Ahri - Alluring', 'Origins'), promo: '0' },
];

describe('Promokarten von dotgg', () => {
  const promo = promoCatalog(rows, sets, [ahri, rune]);

  it('legt Promo-Sets an: zu normalen Sets mit X, sonst nach Set-Name', () => {
    expect(promo.sets).toEqual([
      { setId: 'OGNX', code: 'OGNX', name: 'Origins Promos', promo: true, releaseDate: '2025-10-31' },
      { setId: 'T1', code: 'T1', name: 'T1 2025 Worlds Champion Collection', promo: true },
    ]);
    expect(promo.printings).toHaveLength(4);
  });

  it('übernimmt Name und Text der Grundkarte, damit die Erkennung sie als Variante sieht', () => {
    const [p, r] = promo.printings;
    expect(p).toMatchObject({
      printingId: 'dotgg-ogn-066-p',
      cardName: 'Ahri',
      setCode: 'OGNX',
      collectorNumber: '066',
      variant: 'promo',
      finishes: ['foil'],
      texts: ahri.texts,
      imageUrl: 'https://static.dotgg.gg/riftbound/cards/OGN-066-P.webp',
      attributes: { orientation: 'portrait', event: 'Origins Launch Event Promo' },
      externalIds: { dotgg: 'OGN-066-P', base: 'ogn-066-298' },
    });
    // „126b“ ist eine Promo-Variante der Rune 126
    expect(r).toMatchObject({ cardName: 'Body Rune', collectorNumber: '126b', externalIds: { base: 'ogn-126-298' } });
  });

  it('nimmt ohne Grundkarte die Daten von dotgg', () => {
    expect(promo.printings[2]).toMatchObject({ cardName: 'Ambessa - The Wolf', setCode: 'T1', collectorNumber: '001', texts: { en: 'Ambessa - The Wolf Some text' } });
  });

  it('zerlegt Promo-Nummern', () => {
    expect(splitPromoId('OGN-251-MB-P')).toEqual({ prefix: 'OGN', number: '251-MB' });
    expect(splitPromoId('SGN-002/003-P')).toEqual({ prefix: 'SGN', number: '002/003' });
    expect(splitPromoId('OGN-P')).toEqual({ prefix: 'OGN', number: 'P' });
    expect(promoEvent('Buff (Fist Bump Promo)')).toBe('Fist Bump Promo');
    expect(promoEvent('Ultrasoft Poro')).toBeUndefined();
  });

  it('findet den Preis über die dotgg-Nummer der Promo', () => {
    const { prices } = matchPrices(promo.printings, [{ id: 'OGN-066-P', name: 'Ahri - Alluring (Origins Launch Event Promo)', cmid: 900 }], [], [{ idProduct: 900, trend: 4.5 }]);
    expect(prices['dotgg-ogn-066-p']).toMatchObject({ n: 4.5 });
  });
});

describe('Promo-Ordner', () => {
  const all: CardSet[] = [...sets, { setId: 'OGNX', code: 'OGNX', name: 'Origins Promos', promo: true }, { setId: 'T1', code: 'T1', name: 'T1', promo: true }];

  it('ordnet alle Promo-Sets einem Ordner hinter den normalen Sets zu', () => {
    const folderOf = folderIndex(all);
    expect(folderOf('OGNX')).toEqual({ code: 'PROMO', name: 'Promos', rank: 4 });
    expect(folderOf('T1')).toEqual(folderOf('OGNX'));
    expect(folderOf('SFD')).toEqual({ code: 'SFD', name: 'Spiritforged', rank: 1 });
    expect(folderOf('XYZ').rank).toBeGreaterThan(4);
  });

  it('fasst Promos auch in Liste und Preisen in einer Gruppe zusammen', () => {
    const groups = groupBySet(['T1', 'SFD', 'OGNX', 'OGN'], (code) => ({ gameId: 'riftbound', code }), new Map([['riftbound', all]]));
    expect(groups.map((g) => [g.key, g.name, g.rows])).toEqual([
      ['riftbound|OGN', 'Origins', ['OGN']],
      ['riftbound|SFD', 'Spiritforged', ['SFD']],
      ['riftbound|PROMO', 'Promos', ['T1', 'OGNX']],
    ]);
  });
});
