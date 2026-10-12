import type { CardSet, Printing, Variant } from '../../src/core/types';
import type { GameAdapter } from './types';

/**
 * Offizielle Riftbound-Kartengalerie von Riot. Die Seite enthält die komplette Kartenliste
 * als JSON (Next.js `__NEXT_DATA__`). Riftcodex wäre bequemer, sperrt aber Anfragen aus
 * Rechenzentren (Cloudflare) und damit auch GitHub Actions.
 */
const GALLERY_URL = 'https://playriftbound.com/en-us/card-gallery/';
const USER_AGENT = 'Mozilla/5.0 (compatible; CardScanner/0.1; +https://github.com/Tao2k/cardscanner)';

interface Labeled<T> {
  label?: string;
  value?: T;
  values?: T[];
}
interface Option {
  id: string | number;
  label: string;
}

/** Ausschnitt der Kartenstruktur der Galerie; alles optional, weil die Seite sich ändern kann. */
export interface GalleryCard {
  id: string;
  collectorNumber?: number;
  name: string;
  publicCode?: string;
  set?: Labeled<{ id: string; label: string }>;
  cardType?: { type?: Option[]; superType?: Option[] };
  rarity?: Labeled<Option>;
  domain?: Labeled<Option>;
  cardImage?: { url?: string; accessibilityText?: string };
  orientation?: string;
  illustrator?: Labeled<Option>;
  energy?: Labeled<Option>;
  might?: Labeled<Option>;
  power?: Labeled<Option>;
  tags?: unknown;
}

export interface GallerySet {
  id: string;
  name: string;
  collectorNumberMax?: number;
}

/** Sucht in den Seitendaten die Liste der Karten und Sets, egal an welcher Stelle der Seite sie stehen. */
export function extractGallery(nextData: unknown): { cards: GalleryCard[]; sets: GallerySet[] } {
  let cards: GalleryCard[] = [];
  let sets: GallerySet[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const obj = node as Record<string, unknown>;
    const items = (obj.cards as { items?: unknown[] } | undefined)?.items;
    if (Array.isArray(items) && items.length > cards.length) cards = items as GalleryCard[];
    const setItems = (obj.sets as { items?: unknown[] } | undefined)?.items;
    if (Array.isArray(setItems) && setItems.length > sets.length) sets = setItems as GallerySet[];
    Object.values(obj).forEach(walk);
  };
  walk(nextData);
  return { cards, sets };
}

export function parseNextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Kartengalerie: keine Seitendaten (__NEXT_DATA__) gefunden.');
  return JSON.parse(m[1]);
}

/**
 * Druckvariante aus dem öffentlichen Code ableiten, z. B. „UNL-229*\/219“.
 * „*“ markiert Signature-Drucke, ein Buchstabe hinter der Nummer Alternate Art,
 * eine Nummer über der Setgröße Overnumbered.
 */
export function variantOf(card: GalleryCard, setMax?: number): Variant {
  const number = (card.publicCode ?? card.id).split(/[-/]/)[1] ?? '';
  if (number.includes('*')) return 'signature';
  if (/^\d+[a-z]$/i.test(number)) return 'alt_art';
  if (setMax && card.collectorNumber && card.collectorNumber > setMax) return 'overnumbered';
  return 'normal';
}

/** Die Bilder liegen auf Riots Sanity-CDN, das Größe und Format per URL-Parameter liefert. */
export function sizedImage(url: string, width: number, format?: 'webp' | 'png'): string {
  const u = new URL(url);
  u.searchParams.set('w', String(width));
  if (format) u.searchParams.set('fm', format);
  return u.toString();
}

const optionId = (l?: Labeled<Option>) => (l?.value?.id === undefined ? null : l.value.id);

export function normalizeCard(card: GalleryCard, setMax?: number): Printing | null {
  const imageUrl = card.cardImage?.url;
  if (!card.id || !card.name || !imageUrl) return null;
  const number = (card.publicCode ?? '').split(/[-/]/)[1];
  return {
    printingId: card.id,
    cardName: card.name,
    setCode: card.set?.value?.id ?? '',
    collectorNumber: number || (card.collectorNumber === undefined ? '' : String(card.collectorNumber)),
    variant: variantOf(card, setMax),
    language: 'en',
    rarity: card.rarity?.value?.label,
    type: card.cardType?.type?.map((t) => t.label).join(' / '),
    imageUrl: sizedImage(imageUrl, 480, 'png'),
    thumbUrl: sizedImage(imageUrl, 120, 'webp'),
    attributes: {
      energy: optionId(card.energy),
      might: optionId(card.might),
      power: optionId(card.power),
      domains: card.domain?.values?.map((d) => d.label) ?? [],
      supertypes: card.cardType?.superType?.map((t) => t.label) ?? [],
      artist: card.illustrator?.values?.map((a) => a.label).join(', ') || null,
      orientation: card.orientation ?? 'portrait',
    },
    externalIds: { riot: card.id, ...(card.publicCode ? { publicCode: card.publicCode } : {}) },
  };
}

export const riftbound: GameAdapter = {
  gameId: 'riftbound',
  gameName: 'Riftbound',
  source: 'Offizielle Riftbound-Kartengalerie (playriftbound.com); Kartendaten und Bilder © Riot Games',
  async fetchCatalog({ limit } = {}) {
    const res = await fetch(GALLERY_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    if (!res.ok) throw new Error(`Kartengalerie: HTTP ${res.status}`);
    const { cards, sets } = extractGallery(parseNextData(await res.text()));
    if (!cards.length) throw new Error('Kartengalerie: keine Karten in den Seitendaten gefunden.');

    const setMax = new Map(sets.map((s) => [s.id, s.collectorNumberMax]));
    const seen = new Set<string>();
    const printings: Printing[] = [];
    for (const card of limit ? cards.slice(0, limit) : cards) {
      const p = normalizeCard(card, setMax.get(card.set?.value?.id ?? ''));
      if (!p || seen.has(p.printingId)) continue;
      seen.add(p.printingId);
      printings.push(p);
    }
    const cardSets: CardSet[] = sets.map((s) => ({ setId: s.id, code: s.id, name: s.name }));
    return { sets: cardSets, printings };
  },
};
