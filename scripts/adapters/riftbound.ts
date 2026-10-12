import type { CardSet, Printing, Variant } from '../../src/core/types';
import type { GameAdapter } from './types';

const API = 'https://api.riftcodex.com';
const PAGE_SIZE = 100;
/** Ohne erkennbaren User-Agent lehnt die API Anfragen aus Rechenzentren ab. */
export const HTTP_HEADERS = {
  'User-Agent': 'CardScanner/0.1 (+https://github.com/Tao2k/cardscanner)',
  Accept: 'application/json',
};

/** Ausschnitt der Riftcodex-Kartenstruktur; alle Felder optional, weil die Quelle inoffiziell ist. */
export interface RiftcodexCard {
  id: string;
  name: string;
  riftbound_id?: string;
  tcgplayer_id?: string | number | null;
  public_code?: string;
  collector_number?: number | string;
  attributes?: { energy?: number | null; might?: number | null; power?: number | null };
  classification?: { type?: string; supertype?: string | null; rarity?: string; domain?: string[] };
  set?: { set_id?: string; label?: string };
  media?: { image_url?: string; artist?: string };
  tags?: string[];
  orientation?: string;
  metadata?: { alternate_art?: boolean; overnumbered?: boolean; signature?: boolean };
}

interface Page {
  items: RiftcodexCard[];
  page: number;
  pages: number;
  total: number;
}

export function variantOf(card: RiftcodexCard): Variant {
  const m = card.metadata ?? {};
  if (m.signature) return 'signature';
  if (m.overnumbered) return 'overnumbered';
  if (m.alternate_art) return 'alt_art';
  return 'normal';
}

export function normalizeCard(card: RiftcodexCard): Printing | null {
  const imageUrl = card.media?.image_url;
  if (!imageUrl || !card.name) return null;
  const externalIds: Record<string, string> = { riftcodex: card.id };
  if (card.riftbound_id) externalIds.riftbound = card.riftbound_id;
  if (card.tcgplayer_id) externalIds.tcgplayer = String(card.tcgplayer_id);
  if (card.public_code) externalIds.publicCode = card.public_code;
  return {
    printingId: card.riftbound_id || card.id,
    cardName: card.name,
    setCode: card.set?.set_id ?? '',
    collectorNumber: card.collector_number === undefined ? '' : String(card.collector_number),
    variant: variantOf(card),
    language: 'en',
    rarity: card.classification?.rarity,
    type: card.classification?.type,
    imageUrl,
    attributes: {
      energy: card.attributes?.energy ?? null,
      might: card.attributes?.might ?? null,
      power: card.attributes?.power ?? null,
      domains: card.classification?.domain ?? [],
      supertype: card.classification?.supertype ?? null,
      artist: card.media?.artist ?? null,
      orientation: card.orientation ?? 'portrait',
    },
    externalIds,
  };
}

export function setsFrom(cards: RiftcodexCard[]): CardSet[] {
  const sets = new Map<string, CardSet>();
  for (const c of cards) {
    const code = c.set?.set_id;
    if (code && !sets.has(code)) sets.set(code, { setId: code, code, name: c.set?.label ?? code });
  }
  return [...sets.values()];
}

async function fetchPage(page: number): Promise<Page> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}/cards?page=${page}&size=${PAGE_SIZE}`, { headers: HTTP_HEADERS });
    if (res.ok) return res.json() as Promise<Page>;
    if (attempt >= 4 || res.status < 500) {
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`Riftcodex Seite ${page}: HTTP ${res.status} (server: ${res.headers.get('server') ?? '?'}) ${body}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

export const riftbound: GameAdapter = {
  gameId: 'riftbound',
  gameName: 'Riftbound',
  source: 'Riftcodex (https://riftcodex.com), inoffiziell; Bilder © Riot Games',
  async fetchCatalog({ limit } = {}) {
    const cards: RiftcodexCard[] = [];
    let page = 1;
    let pages = 1;
    do {
      const data = await fetchPage(page);
      cards.push(...data.items);
      pages = data.pages;
      page++;
    } while (page <= pages && (!limit || cards.length < limit));

    const seen = new Set<string>();
    const printings: Printing[] = [];
    for (const card of limit ? cards.slice(0, limit) : cards) {
      const p = normalizeCard(card);
      if (!p || seen.has(p.printingId)) continue;
      seen.add(p.printingId);
      printings.push(p);
    }
    return { sets: setsFrom(cards), printings };
  },
};
