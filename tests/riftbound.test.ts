import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractGallery, normalizeCard, parseNextData } from '../scripts/adapters/riftbound';

const html = readFileSync(new URL('./fixtures/riftbound-gallery.html', import.meta.url), 'utf8');
const { cards, sets } = extractGallery(parseNextData(html));
const max = (code: string) => sets.find((s) => s.id === code)?.collectorNumberMax;

describe('Riftbound-Adapter (offizielle Galerie)', () => {
  it('findet Karten und Sets in den Seitendaten', () => {
    expect(cards).toHaveLength(5);
    expect(sets.map((s) => s.id)).toEqual(['UNL', 'OGN']);
  });

  it('wandelt Galerie-Karten in Drucke um', () => {
    expect(normalizeCard(cards[0], max('UNL'))).toMatchObject({
      printingId: 'unl-131-219',
      cardName: 'Abandon',
      setCode: 'UNL',
      collectorNumber: '131',
      variant: 'normal',
      rarity: 'Uncommon',
      type: 'Spell',
      attributes: { energy: 2, domains: ['Chaos'], artist: 'Kudos Productions' },
      externalIds: { riot: 'unl-131-219', publicCode: 'UNL-131/219' },
      imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/89929cfa-744x1039.png?accountingTag=RB&w=480&fm=png',
      thumbUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/89929cfa-744x1039.png?accountingTag=RB&w=120&fm=webp',
    });
  });

  it('erkennt Druckvarianten', () => {
    expect(normalizeCard(cards[1], max('UNL'))).toMatchObject({ variant: 'signature', collectorNumber: '229*' });
    expect(normalizeCard(cards[2], max('OGN'))?.variant).toBe('overnumbered');
    expect(normalizeCard(cards[3], max('OGN'))).toMatchObject({ variant: 'alt_art', collectorNumber: '066a' });
  });

  it('überspringt Karten ohne Bild', () => {
    expect(normalizeCard(cards[4])).toBeNull();
  });

  it('meldet fehlende Seitendaten verständlich', () => {
    expect(() => parseNextData('<html></html>')).toThrow(/__NEXT_DATA__/);
  });
});
