import type { PriceEntry } from '../../src/core/prices';
import type { Printing } from '../../src/core/types';

/**
 * Riftbound-Preise von Cardmarket (Euro).
 *
 * Cardmarket veröffentlicht für jedes Spiel täglich einen Preisguide und einen Produktkatalog
 * (frei, ohne Anmeldung; Riftbound hat dort die Spiel-ID 22). Beide kennen nur Cardmarkets
 * Produktnummer, keine Set-Nummer. Die Brücke liefert die öffentliche Kartenliste von dotgg:
 * pro Karte die Nummer (z. B. „OGN-066a“) und die Cardmarket-Produktnummer (`cmid`).
 */
export const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json';
export const PRODUCT_LIST_URL = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_22.json';
export const DOTGG_URL = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';

export interface GuideRow {
  idProduct: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  'avg-foil'?: number | null;
  'low-foil'?: number | null;
  'trend-foil'?: number | null;
  'avg1-foil'?: number | null;
  'avg7-foil'?: number | null;
  'avg30-foil'?: number | null;
}
export interface PriceGuide {
  createdAt: string;
  priceGuides: GuideRow[];
}
export interface CmProduct {
  idProduct: number;
  name: string;
  idExpansion: number;
}
export interface DotggCard {
  id: string;
  name: string;
  cmid?: number;
  cmurl?: string;
}

/** dotgg liefert {names: [...], data: [[...], ...]} mit Werten nach Position. */
export function parseDotgg(json: { names: string[]; data: unknown[][] }): DotggCard[] {
  const col = (name: string) => json.names.indexOf(name);
  const [id, name, cmid, cmurl] = [col('id'), col('name'), col('cmid'), col('cmurl')];
  if (id < 0 || name < 0 || cmid < 0) throw new Error('dotgg: Spalten id, name oder cmid fehlen.');
  return json.data.map((row) => {
    const productId = Number(row[cmid]);
    return {
      id: String(row[id]),
      name: String(row[name]),
      ...(row[cmid] != null && Number.isInteger(productId) && productId > 0 ? { cmid: productId } : {}),
      ...(cmurl >= 0 && typeof row[cmurl] === 'string' && row[cmurl] ? { cmurl: row[cmurl] as string } : {}),
    };
  });
}

/** Name ohne Satzzeichen und Zusätze in Klammern: „Ahri - Alluring“ = „Ahri, Alluring“. */
export function nameKey(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Tippfehler-Abstand (Optimal String Alignment: einfügen, löschen, ersetzen, Nachbarn tauschen). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Gleicher Name trotz anderer Schreibweise. Riots Galerie nennt Champions nur „Ahri“ und Legenden nur
 * „Blind Monk“, dotgg „Ahri - Alluring“ bzw. „Lee Sin - Blind Monk“, Cardmarket „Ahri, Alluring“;
 * Tokens heißen dort „Bird // Buff“. Daher zählt auch ein Teil des Namens. Kleine Tippfehler
 * („Corinna“/„Corina“) sind erlaubt, weil Set und Nummer die Karte schon festlegen.
 */
export function sameName(theirs: string, ours: string): boolean {
  const own = nameKey(ours);
  if (!own) return false;
  const parts = [theirs, ...theirs.replace(/\([^)]*\)/g, '').split(/\s+-\s+|\s*\/\/\s*|,\s+/)].map(nameKey);
  if (parts.includes(own)) return true;
  return own.length >= 6 && editDistance(nameKey(theirs), own) <= 2;
}

/**
 * Nummer eines Drucks im Format von dotgg: Set-Code, Nummer dreistellig, Buchstabe für Alternate Art,
 * „-star“ für Signature (bei Riot „*“). Vergleich ohne Groß-/Kleinschreibung.
 */
export function dotggKey(p: Pick<Printing, 'setCode' | 'collectorNumber'>): string {
  const set = p.setCode.toLowerCase();
  const m = p.collectorNumber.trim().match(/^(\d+)([a-z]?)(\*?)$/i);
  if (!m) return `${set}-${p.collectorNumber.trim().toLowerCase()}`;
  return `${set}-${m[1].padStart(3, '0')}${m[2].toLowerCase()}${m[3] ? '-star' : ''}`;
}

const NORMAL_FIELDS = ['trend', 'avg7', 'avg30', 'avg'] as const;
const FOIL_FIELDS = ['trend-foil', 'avg7-foil', 'avg30-foil', 'avg-foil'] as const;

/** Trendpreis, sonst Durchschnitt 7, 30 Tage, gesamt. Den Tiefstpreis nie: ein einzelnes Angebot verzerrt ihn. */
export function pickPrice(row: GuideRow, fields: readonly (keyof GuideRow)[]): number | undefined {
  for (const f of fields) {
    const v = row[f];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

export function guideEntry(row: GuideRow | undefined): Omit<PriceEntry, 'url'> | undefined {
  if (!row) return undefined;
  const n = pickPrice(row, NORMAL_FIELDS);
  const f = pickPrice(row, FOIL_FIELDS);
  if (n === undefined && f === undefined) return undefined;
  return { ...(n !== undefined ? { n } : {}), ...(f !== undefined ? { f } : {}) };
}

/** Cardmarket schreibt „2026-10-21T02:48:35+0200“; Date braucht den Doppelpunkt im Versatz. */
export function isoTime(value: string): string {
  const d = new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

export interface MatchReport {
  printings: number;
  linked: number;
  priced: number;
  /** davon über Name und Set im Cardmarket-Katalog zugeordnet */
  byName: number;
  rejected: string[];
}

/**
 * Ordnet jedem Druck eine Cardmarket-Produktnummer zu und holt den Preis.
 * 1. dotgg-Nummer = Set + Nummer des Drucks und der Name passt (siehe sameName).
 * 2. Sonst (nur normale Drucke): genau ein Produkt mit gleichem Namen in derselben Cardmarket-Erweiterung.
 * Was nicht eindeutig passt, bleibt ohne Preis, statt falsch bepreist zu werden.
 */
export function matchPrices(
  printings: Printing[],
  dotgg: DotggCard[],
  products: CmProduct[],
  guide: GuideRow[],
): { prices: Record<string, PriceEntry>; report: MatchReport } {
  const byKey = new Map(dotgg.map((c) => [c.id.toLowerCase(), c]));
  const productById = new Map(products.map((p) => [p.idProduct, p]));
  const guideById = new Map(guide.map((g) => [g.idProduct, g]));
  const report: MatchReport = { printings: printings.length, linked: 0, priced: 0, byName: 0, rejected: [] };

  const linked = new Map<string, { idProduct: number; url?: string }>();
  for (const p of printings) {
    const card = byKey.get(dotggKey(p));
    if (!card?.cmid) continue;
    if (!sameName(card.name, p.cardName)) {
      report.rejected.push(`${p.printingId}: dotgg ${card.id} heißt „${card.name}“, nicht „${p.cardName}“`);
      continue;
    }
    if (products.length && !productById.has(card.cmid)) {
      report.rejected.push(`${p.printingId}: Produkt ${card.cmid} fehlt im Cardmarket-Katalog`);
      continue;
    }
    linked.set(p.printingId, { idProduct: card.cmid, ...(card.cmurl ? { url: card.cmurl } : {}) });
  }

  // Erweiterung je Set aus den sicheren Zuordnungen ablesen (häufigste gewinnt).
  const votes = new Map<string, Map<number, number>>();
  for (const p of printings) {
    const exp = productById.get(linked.get(p.printingId)?.idProduct ?? -1)?.idExpansion;
    if (exp === undefined) continue;
    const v = votes.get(p.setCode) ?? new Map<number, number>();
    v.set(exp, (v.get(exp) ?? 0) + 1);
    votes.set(p.setCode, v);
  }
  const expansionOf = new Map([...votes].map(([set, v]) => [set, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  const used = new Set([...linked.values()].map((l) => l.idProduct));
  for (const p of printings) {
    if (linked.has(p.printingId) || p.variant !== 'normal') continue;
    const exp = expansionOf.get(p.setCode);
    if (exp === undefined) continue;
    const candidates = products.filter((c) => c.idExpansion === exp && !used.has(c.idProduct) && sameName(c.name, p.cardName));
    if (candidates.length !== 1) continue;
    linked.set(p.printingId, { idProduct: candidates[0].idProduct });
    used.add(candidates[0].idProduct);
    report.byName++;
  }

  const prices: Record<string, PriceEntry> = {};
  for (const [printingId, { idProduct, url }] of linked) {
    report.linked++;
    const entry = guideEntry(guideById.get(idProduct));
    if (!entry) continue;
    report.priced++;
    prices[printingId] = { ...entry, ...(url ? { url } : {}) };
  }
  return { prices, report };
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'ScannR/0.1 (+https://github.com/Tao2k/cardscanner)', Accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 3) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

export async function fetchRiftboundPrices(printings: Printing[]) {
  const [guide, productList, dotggJson] = await Promise.all([
    getJson<PriceGuide>(PRICE_GUIDE_URL),
    getJson<{ products: CmProduct[] }>(PRODUCT_LIST_URL),
    getJson<{ names: string[]; data: unknown[][] }>(DOTGG_URL),
  ]);
  const { prices, report } = matchPrices(printings, parseDotgg(dotggJson), productList.products, guide.priceGuides);
  return {
    source: 'Cardmarket',
    sourceUrl: 'https://www.cardmarket.com/en/Riftbound',
    asOf: isoTime(guide.createdAt),
    prices,
    report,
  };
}
