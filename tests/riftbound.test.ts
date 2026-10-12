import { describe, expect, it } from 'vitest';
import page from './fixtures/riftcodex-page.json';
import { normalizeCard, setsFrom, type RiftcodexCard } from '../scripts/adapters/riftbound';

const cards = page.items as RiftcodexCard[];

describe('Riftbound-Adapter', () => {
  it('wandelt Riftcodex-Karten in Drucke um', () => {
    expect(normalizeCard(cards[0])).toMatchObject({
      printingId: 'unl-229*-219',
      cardName: 'Vi - Piltover Enforcer (Signature)',
      setCode: 'UNL',
      collectorNumber: '229',
      variant: 'signature',
      rarity: 'Rare',
      type: 'Legend',
      externalIds: { riftcodex: '69c4407c9288b1e85d94de8a', tcgplayer: '685522', publicCode: 'UNL-229*/219' },
    });
    expect(normalizeCard(cards[1])?.variant).toBe('normal');
  });

  it('überspringt Karten ohne Bild', () => {
    expect(normalizeCard(cards[2])).toBeNull();
  });

  it('leitet die Sets aus den Karten ab', () => {
    expect(setsFrom(cards).map((s) => s.code)).toEqual(['UNL', 'OGN']);
  });
});
