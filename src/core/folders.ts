import { compareCollectorNumbers, setRanks } from './excel';
import type { CardSet, Printing } from './types';

/**
 * Ordner in Sammlung und Preise: jedes Set ist ein Ordner, nur die Promo-Sets (Events, Bundles,
 * Box-Sets) teilen sich einen, damit die vielen kleinen Sets nicht einzeln herumstehen.
 */

export const PROMO_FOLDER = 'PROMO';
export const PROMO_NAME = 'Promos';

/**
 * Gesamtordner über alle Sets: Rare, Epic und Showcase (Alternate Art, Overnumbered, Signature), die man besitzt.
 * Runen stehen darin am Ende ihrer Domain, auch wenn ihre Sammlernummer woanders liegt.
 */
export const HIGHLIGHT_FOLDER = 'HIGHLIGHTS';
export const HIGHLIGHT_NAME = 'Rare, Epic, Showcase';
const HIGHLIGHT_RARITIES = ['rare', 'epic', 'showcase'];

/** Gehört der Druck in den Gesamtordner? Promos nicht, die haben ihren eigenen Ordner. */
export function isHighlight(p: Printing, set?: CardSet): boolean {
  if (set?.promo || p.variant === 'promo') return false;
  return HIGHLIGHT_RARITIES.includes((p.rarity ?? '').toLowerCase()) || ['alt_art', 'overnumbered', 'signature'].includes(p.variant);
}

const isRune = (p: Printing) => /\brune\b/i.test(p.type ?? '');
const domainOf = (p: Printing): string | undefined => {
  const d = p.attributes?.domains;
  return Array.isArray(d) && d.length === 1 && typeof d[0] === 'string' ? d[0] : undefined;
};
const baseNumber = (n: string) => {
  const m = n.trim().match(/^\d+/);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
};

/**
 * Reihenfolge im Gesamtordner: nach Set und Nummer wie in den Set-Ordnern, nur Runen rücken ans Ende ihrer
 * Domain, also hinter die höchste Nummer einer normalen Karte derselben Domain im selben Set.
 * `catalog` sind alle Drucke des Spiels, damit die Grenzen nicht davon abhängen, was man besitzt.
 */
export function highlightOrder(sets: CardSet[], catalog: Iterable<Printing>): (a: Printing, b: Printing) => number {
  const ranks = setRanks(sets);
  const rank = (p: Printing) => ranks.get(p.setCode) ?? Number.MAX_SAFE_INTEGER;
  const domainEnd = new Map<string, number>();
  for (const p of catalog) {
    const domain = domainOf(p);
    const n = baseNumber(p.collectorNumber);
    if (p.variant !== 'normal' || isRune(p) || !domain || !Number.isFinite(n)) continue;
    const key = `${p.setCode}|${domain}`;
    domainEnd.set(key, Math.max(domainEnd.get(key) ?? 0, n));
  }
  const anchor = (p: Printing): [number, number] => {
    const end = isRune(p) && domainOf(p) ? domainEnd.get(`${p.setCode}|${domainOf(p)}`) : undefined;
    return end === undefined ? [baseNumber(p.collectorNumber), 0] : [end, 1];
  };
  return (a, b) => {
    const [na, ra] = anchor(a);
    const [nb, rb] = anchor(b);
    return (
      rank(a) - rank(b) ||
      a.setCode.localeCompare(b.setCode) ||
      (na === nb ? 0 : na < nb ? -1 : 1) ||
      ra - rb ||
      compareCollectorNumbers(a.collectorNumber, b.collectorNumber) ||
      a.cardName.localeCompare(b.cardName)
    );
  };
}

export interface Folder {
  /** Set-Kürzel oder PROMO_FOLDER */
  code: string;
  name: string;
  /** Reihenfolge: Sets nach Erscheinen, Promos danach, unbekannte Sets ganz am Ende */
  rank: number;
}

/** Ordner eines Sets; die Promos stehen hinter allen normalen Sets. */
export function folderIndex(sets: CardSet[]): (setCode: string) => Folder {
  const ranks = setRanks(sets);
  const byCode = new Map(sets.map((s) => [s.code, s]));
  const promoRank = sets.length;
  return (code) => {
    const set = byCode.get(code);
    if (set?.promo) return { code: PROMO_FOLDER, name: PROMO_NAME, rank: promoRank };
    return { code, name: set?.name ?? (code || 'Ohne Set'), rank: set ? ranks.get(code)! : Number.MAX_SAFE_INTEGER };
  };
}

/** Karten innerhalb eines Ordners: im Promo-Ordner erst nach Set (nach Erscheinen), dann nach Nummer. */
export function slotOrder(sets: CardSet[]): (a: Printing, b: Printing) => number {
  const ranks = setRanks(sets);
  const rank = (p: Printing) => ranks.get(p.setCode) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) =>
    rank(a) - rank(b) ||
    a.setCode.localeCompare(b.setCode) ||
    compareCollectorNumbers(a.collectorNumber, b.collectorNumber) ||
    a.cardName.localeCompare(b.cardName);
}
