import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addLocale, extractGallery, normalizeCard, parseNextData } from '../scripts/adapters/riftbound';

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
      finishes: ['normal', 'foil'],
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
    // Showcase-Drucke gibt es nur als Foil
    expect(normalizeCard(cards[1], max('UNL'))?.finishes).toEqual(['foil']);
  });

  it('überspringt Karten ohne Bild', () => {
    expect(normalizeCard(cards[4])).toBeNull();
  });

  it('ergänzt Namen und abweichende Bilder anderer Sprachen', () => {
    const base = normalizeCard(cards[0], max('UNL'))!;
    const fr = addLocale(base, { ...cards[0], name: 'Abandon' }, 'fr');
    expect(fr.names).toBeUndefined(); // gleicher Name wie Englisch
    expect(fr.images).toBeUndefined(); // gleiches Bild wie Englisch
    const zh = addLocale(base, { ...cards[0], name: '遗弃', cardImage: { url: 'https://cmsassets.rgpub.io/sanity/images/zh.png?accountingTag=RB' } }, 'zh-CN');
    expect(zh.names).toEqual({ 'zh-CN': '遗弃' });
    expect(zh.images?.['zh-CN'].imageUrl).toBe('https://cmsassets.rgpub.io/sanity/images/zh.png?accountingTag=RB&w=480&fm=png');
  });

  it('meldet fehlende Seitendaten verständlich', () => {
    expect(() => parseNextData('<html></html>')).toThrow(/__NEXT_DATA__/);
  });
});
