import type { CardSet, Finish, Printing, Variant } from '../../src/core/types';
import { fetchRiftboundPrices } from './riftbound-prices';
import type { GameAdapter } from './types';

/**
 * Offizielle Riftbound-Kartengalerie von Riot. Die Seite enthält die komplette Kartenliste
 * als JSON (Next.js `__NEXT_DATA__`). Riftcodex wäre bequemer, sperrt aber Anfragen aus
 * Rechenzentren (Cloudflare) und damit auch GitHub Actions.
 */
const GALLERY_URL = (locale: string) => `https://playriftbound.com/${locale}/card-gallery/`;

/**
 * Drucksprachen und ihre Galerie-Locale. Englisch ist die Basis; die anderen Galerien
 * liefern lokalisierte Namen und (bisher nur teilweise, v. a. Chinesisch) eigene Kartenbilder.
 */
export const LOCALES = [
  { code: 'en', label: 'EN', locale: 'en-us' },
  { code: 'fr', label: 'FR', locale: 'fr-fr' },
  { code: 'zh-CN', label: 'ZH', locale: 'zh-cn' },
] as const;
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
  text?: { richText?: { body?: string } };
  tags?: unknown;
}

export interface GallerySet {
  id: string;
  name: string;
  collectorNumberMax?: number;
  [key: string]: unknown;
}

/**
 * Erscheinungsdaten (weltweit), weil die Galerie keine liefert und die Sets alphabetisch listet.
 * Quelle: runeweave.com/sets (Stand Oktober 2026). Neue Sets ohne Eintrag kommen im Export ans Ende.
 */
export const RELEASE_DATES: Record<string, string> = {
  OGN: '2025-10-31',
  OGS: '2025-10-31',
  SFD: '2026-02-13',
  UNL: '2026-05-08',
  VEN: '2026-07-31',
  RAD: '2026-10-23',
};

/** Erscheinungsdatum eines Sets (JJJJ-MM-TT), falls die Galerie eins mitliefert (Feldname unbekannt, daher gesucht). */
export function releaseDateOf(set: GallerySet): string | undefined {
  for (const [key, value] of Object.entries(set)) {
    if (!/date|release/i.test(key) || typeof value !== 'string') continue;
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return undefined;
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

/**
 * Riftbound: Rare, Epic und alle Showcase-Drucke (Alternate Art, Overnumbered, Signature) gibt es nur
 * als Foil; Common und Uncommon normal und als Foil (Foil-Slot im Booster).
 */
export function riftboundFinishes(card: GalleryCard, variant: Variant): Finish[] {
  const rarity = card.rarity?.value?.label?.toLowerCase() ?? '';
  return variant !== 'normal' || ['rare', 'epic', 'showcase'].includes(rarity) ? ['foil'] : ['normal', 'foil'];
}

/** Die Bilder liegen auf Riots Sanity-CDN, das Größe und Format per URL-Parameter liefert. */
export function sizedImage(url: string, width: number, format?: 'webp' | 'png'): string {
  const u = new URL(url);
  u.searchParams.set('w', String(width));
  if (format) u.searchParams.set('fm', format);
  return u.toString();
}

/** Name und Regeltext als einfacher Text (für die Spracherkennung). */
export function plainText(card: GalleryCard): string {
  const body = card.text?.richText?.body ?? '';
  const text = body
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return `${card.name} ${text}`.trim();
}

const optionId = (l?: Labeled<Option>) => (l?.value?.id === undefined ? null : l.value.id);

export function normalizeCard(card: GalleryCard, setMax?: number): Printing | null {
  const imageUrl = card.cardImage?.url;
  if (!card.id || !card.name || !imageUrl) return null;
  const number = (card.publicCode ?? '').split(/[-/]/)[1];
  const variant = variantOf(card, setMax);
  return {
    printingId: card.id,
    cardName: card.name,
    setCode: card.set?.value?.id ?? '',
    collectorNumber: number || (card.collectorNumber === undefined ? '' : String(card.collectorNumber)),
    variant,
    finishes: riftboundFinishes(card, variant),
    texts: { en: plainText(card) },
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
    externalIds: { riot: card.id, imageSource: imageUrl, ...(card.publicCode ? { publicCode: card.publicCode } : {}) },
  };
}

/**
 * Ergänzt einen Druck um Name und Bild aus einer anderen Sprachgalerie.
 * Ein Bild wird nur übernommen, wenn es sich vom englischen unterscheidet, sonst wäre es doppelt im Index.
 */
export function addLocale(printing: Printing, card: GalleryCard, lang: string): Printing {
  const names = card.name && card.name !== printing.cardName ? { ...printing.names, [lang]: card.name } : printing.names;
  const texts = { ...printing.texts, [lang]: plainText(card) };
  const url = card.cardImage?.url;
  const baseUrl = printing.externalIds?.imageSource;
  const images =
    url && url !== baseUrl
      ? { ...printing.images, [lang]: { imageUrl: sizedImage(url, 480, 'png'), thumbUrl: sizedImage(url, 120, 'webp') } }
      : printing.images;
  return { ...printing, texts, ...(names ? { names } : {}), ...(images ? { images } : {}) };
}

async function fetchGallery(locale: string) {
  const res = await fetch(GALLERY_URL(locale), { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Kartengalerie ${locale}: HTTP ${res.status}`);
  const gallery = extractGallery(parseNextData(await res.text()));
  if (!gallery.cards.length) throw new Error(`Kartengalerie ${locale}: keine Karten in den Seitendaten gefunden.`);
  return gallery;
}

export const riftbound: GameAdapter = {
  gameId: 'riftbound',
  gameName: 'Riftbound',
  source: 'Offizielle Riftbound-Kartengalerie (playriftbound.com); Kartendaten und Bilder © Riot Games',
  languages: LOCALES.map(({ code, label }) => ({ code, label })),
  fetchPrices: fetchRiftboundPrices,
  async fetchCatalog({ limit } = {}) {
    const galleries = [];
    for (const l of LOCALES) galleries.push({ lang: l.code, ...(await fetchGallery(l.locale)) });
    const sets = galleries[0].sets;
    const setMax = new Map(sets.map((s) => [s.id, s.collectorNumberMax]));

    // Englisch ist die Basis; Karten, die nur in einer anderen Galerie stehen, kommen mit deren Daten dazu.
    const byId = new Map<string, Printing>();
    for (const { lang, cards } of galleries) {
      for (const card of cards) {
        const existing = byId.get(card.id);
        if (existing) {
          byId.set(card.id, addLocale(existing, card, lang));
          continue;
        }
        const p = normalizeCard(card, setMax.get(card.set?.value?.id ?? ''));
        if (!p) continue;
        byId.set(card.id, p);
      }
    }
    const printings = [...byId.values()].slice(0, limit ?? Infinity);
    // Datum aus der Galerie, sonst aus RELEASE_DATES
    const cardSets: CardSet[] = sets.map((s) => ({ setId: s.id, code: s.id, name: s.name, releaseDate: releaseDateOf(s) ?? RELEASE_DATES[s.id] }));
    console.log(`Sets in der Galerie: ${cardSets.map((s) => `${s.code} „${s.name}“ ${s.releaseDate ?? 'ohne Datum'}`).join(' · ')}`);
    return { sets: cardSets, printings };
  },
};
