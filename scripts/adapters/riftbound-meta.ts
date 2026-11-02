import { kindOf } from '../../src/core/deck';
import type { MetaDeck } from '../../src/core/meta';
import type { Printing } from '../../src/core/types';
import { dotggKey } from './riftbound-prices';
import type { MetaResult } from './types';

/**
 * Turnierlisten von riftbound.gg (dotgg). Die öffentliche Deckliste der Seite lässt sich nach Turnierdecks
 * und Platzierung filtern; ein Schlüssel ist nicht nötig. Sie liefert höchstens 25 Seiten zu 30 Listen.
 */
const API = 'https://api.dotgg.gg/cgfw/getdecks?game=riftbound&rq=';
const PAGE_SIZE = 30;
const MAX_PAGES = 25;
/** Zuerst nur Listen bis Platz 8. */
export const TOP = 8;
/** Weniger Turnierlisten als hier: auch schwächere Plätze der Legende holen. */
const WANTED = 30;
/** Immer noch weniger als hier: dazu Decks aus der Community. */
const SPARSE = 15;
/** Ältere Listen bringen nichts mehr, die Meta hat sich seitdem verschoben. */
const MAX_AGE_DAYS = 120;

export interface DotggDeck {
  slug: string;
  date: string;
  leader?: string;
  is_tournament?: string;
  boards?: Record<string, string>[];
  deck?: Record<string, string>;
  tournament?: { place?: number; tournament_id?: number; tournament_name?: string } | null;
}

export function deckQuery(page: number, filter: Record<string, unknown>): string {
  const rq = { page, limit: PAGE_SIZE, srt: 'date', direct: 'desc', type: '', my: 0, myarchive: 0, fav: 0, getdecks: { is_tournament: 1, ...filter } };
  return API + encodeURIComponent(JSON.stringify(rq));
}

/** dotgg-Nummer („OGN-042“, „OGN-042a“, „SFD-195-star“) → Druck aus unserem Katalog. */
export function dotggIndex(printings: Printing[]): Map<string, string> {
  const index = new Map<string, string>();
  const rank = (p: Printing) => (p.variant === 'normal' ? 0 : 1);
  const byKey = new Map<string, Printing>();
  for (const p of printings) {
    for (const key of [dotggKey(p), p.externalIds?.dotgg?.toLowerCase()]) {
      if (!key) continue;
      const current = byKey.get(key);
      if (!current || rank(p) < rank(current)) byKey.set(key, p);
    }
  }
  for (const [key, p] of byKey) index.set(key, p.printingId);
  return index;
}

/** Eine dotgg-Liste in unser Format; unbekannte Nummern landen in `unknown`. */
export function toMetaDeck(d: DotggDeck, index: Map<string, string>, unknown: Set<string>): MetaDeck | null {
  const convert = (board: Record<string, string> | undefined) => {
    const out: Record<string, number> = {};
    for (const [code, n] of Object.entries(board ?? {})) {
      const count = Number(n);
      if (!(count > 0)) continue;
      const id = index.get(code.toLowerCase());
      if (!id) {
        unknown.add(code);
        continue;
      }
      out[id] = (out[id] ?? 0) + count;
    }
    return out;
  };
  const cards = convert(d.boards?.[0] ?? d.deck);
  if (!Object.keys(cards).length) return null;
  const side = convert(d.boards?.[1]);
  const seconds = Number(d.date);
  return {
    id: d.slug,
    event: d.tournament?.tournament_name?.trim() || 'Turnier',
    ...(d.tournament?.place ? { place: d.tournament.place } : {}),
    date: new Date(Number.isFinite(seconds) ? seconds * 1000 : Date.parse(d.date)).toISOString().slice(0, 10),
    cards,
    ...(Object.keys(side).length ? { side } : {}),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pause zwischen zwei Abfragen: dotgg drosselt sonst mit HTTP 429. */
const PAUSE_MS = 800;

async function getDecks(url: string): Promise<DotggDeck[]> {
  for (let attempt = 1; ; attempt++) {
    await sleep(PAUSE_MS);
    const res = await fetch(url, { headers: { 'User-Agent': 'ScannR/0.1 (+https://github.com/Tao2k/cardscanner)', Accept: 'application/json' } });
    if (res.ok) return (await res.json()) as DotggDeck[];
    if (attempt >= 4) throw new Error(`${url}: HTTP ${res.status}`);
    await sleep((res.status === 429 ? 15000 : 3000) * attempt);
  }
}

/** Spielt die Liste diese Legende? Community-Decks haben oft kein Feld „leader“, dann zählt die Kartenliste. */
export function hasLegend(d: DotggDeck, code: string): boolean {
  if (d.leader) return d.leader.toUpperCase() === code.toUpperCase();
  const board = d.boards?.[0] ?? d.deck ?? {};
  return Object.keys(board).some((c) => c.toUpperCase() === code.toUpperCase());
}

async function pages(filter: Record<string, unknown>, maxPages: number, since: number, tournament = true): Promise<DotggDeck[]> {
  const out: DotggDeck[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const list = await getDecks(deckQuery(page, tournament ? filter : { ...filter, is_tournament: '' }));
    if (!Array.isArray(list) || !list.length) break;
    out.push(...list.filter((d) => (tournament ? d.is_tournament === '1' : d.is_tournament !== '1')));
    if (list.length < PAGE_SIZE || Number(list.at(-1)!.date) * 1000 < since) break;
  }
  return out;
}

/**
 * Turnierlisten holen:
 *   1. die Top 8 aller Turniere (so weit die Quelle zurückreicht)
 *   2. für Legenden mit wenigen Listen: alle Turnierlisten mit der Legende, auch schwächere Plätze
 *   3. ist es dann immer noch dünn: veröffentlichte Decks der Community mit der Legende (wie die
 *      Kartenstatistik auf riftdecks.com, die alle Decks einer Legende auswertet); sie zählen weniger
 */
export async function fetchRiftboundMeta(printings: Printing[]): Promise<MetaResult> {
  const since = Date.now() - MAX_AGE_DAYS * 864e5;
  const index = dotggIndex(printings);
  const raw = new Map<string, DotggDeck & { community?: boolean }>();
  for (const d of await pages({ placement: String(TOP) }, MAX_PAGES, since)) raw.set(d.slug, d);

  const count = (code: string, community = false) => [...raw.values()].filter((d) => hasLegend(d, code) && !!d.community === community).length;
  const legends = printings.filter((p) => kindOf(p) === 'legend' && p.variant === 'normal' && /^\d+$/.test(p.collectorNumber.trim()));
  let extra = 0;
  let community = 0;
  const add = (code: string, found: DotggDeck[], isCommunity: boolean) => {
    for (const d of found) {
      // Kennt die Quelle den Filter nicht, kommen fremde Legenden zurück; die zählen hier nicht
      if (!hasLegend(d, code) || raw.has(d.slug)) continue;
      raw.set(d.slug, isCommunity ? { ...d, community: true } : d);
      if (isCommunity) community++;
      else extra++;
    }
  };
  for (const legend of legends) {
    const code = dotggKey(legend).toUpperCase();
    try {
      if (count(code) < WANTED) add(code, await pages({ hascrd: [code] }, 2, since), false);
      if (count(code) < SPARSE) add(code, await pages({ hascrd: [code] }, 2, since, false), true);
    } catch (e) {
      console.warn(`Listen für ${code} übersprungen: ${e}`);
    }
  }

  const unknown = new Set<string>();
  const decks = [...raw.values()]
    .filter((d) => Number(d.date) * 1000 >= since)
    .map((d) => {
      const deck = toMetaDeck(d, index, unknown);
      return deck && d.community ? { ...deck, community: true as const } : deck;
    })
    .filter((d): d is MetaDeck => !!d)
    .sort((a, b) => b.date.localeCompare(a.date) || (a.place ?? 9999) - (b.place ?? 9999));
  return {
    source: 'riftbound.gg',
    sourceUrl: 'https://riftbound.gg/decks/',
    maxPlace: TOP,
    decks,
    report: { fetched: raw.size, extra, community, unknown: [...unknown].sort() },
  };
}
