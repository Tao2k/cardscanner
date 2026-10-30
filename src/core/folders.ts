import { compareCollectorNumbers, setRanks } from './excel';
import type { CardSet, Printing } from './types';

/**
 * Ordner in Sammlung und Preise: jedes Set ist ein Ordner, nur die Promo-Sets (Events, Bundles,
 * Box-Sets) teilen sich einen, damit die vielen kleinen Sets nicht einzeln herumstehen.
 */

export const PROMO_FOLDER = 'PROMO';
export const PROMO_NAME = 'Promos';

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
