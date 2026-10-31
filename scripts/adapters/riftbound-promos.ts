import type { CardSet, Finish, Printing } from '../../src/core/types';
import { dotggKey, sameName } from './riftbound-prices';

/**
 * Promokarten (Events, Turniere, Bundles, Box-Sets). Riots Galerie führt keine einzige davon,
 * die öffentliche Kartenliste von dotgg schon (Spalte promo = 1). Jede Promo eines normalen Sets
 * kommt in ein eigenes Promo-Set mit X dahinter (Origins → OGNX), wie es Sammler nennen;
 * Promo-Sets ohne normales Set (T1-Bundle, Arcane Box Set, Secret Garden) behalten ihren Namen.
 * Die App fasst alle Promo-Sets in einem Ordner zusammen (src/core/folders.ts).
 */

/** Zeile der dotgg-Kartenliste als Objekt (Spaltennamen siehe parseDotgg). */
export type DotggRow = Record<string, unknown>;

export function dotggRows(json: { names: string[]; data: unknown[][] }): DotggRow[] {
  return json.data.map((row) => Object.fromEntries(json.names.map((n, i) => [n, row[i]])));
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** Regeltext von dotgg als einfacher Text; Symbole wie :rb_might: fallen weg. */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/:rb_[a-z_0-9]+:/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** „OGN-066-P“ → Set „OGN“, Nummer „066“; „OGN-251-MB-P“ → „251-MB“; „OGN-P“ → „P“. */
export function splitPromoId(id: string): { prefix: string; number: string } {
  const [prefix, ...rest] = id.split('-');
  const number = rest.join('-').replace(/-P$/i, '');
  return { prefix, number: number || 'P' };
}

/** Anlass aus dem Namen, z. B. „Origins Launch Event Promo“ aus „Ahri - Alluring (Origins Launch Event Promo)“. */
export function promoEvent(name: string): string | undefined {
  return name.match(/\(([^)]*)\)\s*$/)?.[1];
}

/** Gemeinsamer Anfang der Set-Präfixe, z. B. „T1“ aus „T1A“ und „T1S“. */
function commonPrefix(list: string[]): string {
  let p = list[0] ?? '';
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p || list[0];
}

/**
 * Promo-Drucke aus der dotgg-Liste. Wo es die Karte in einem normalen Set gibt (gleiche Nummer und
 * gleicher Name), übernimmt die Promo von dort Namen, Texte und Werte, damit die Texterkennung sie
 * als Variante derselben Karte sieht und per Bild oder Nummer unterscheidet.
 */
export function promoCatalog(rows: DotggRow[], sets: CardSet[], printings: Printing[]): { sets: CardSet[]; printings: Printing[] } {
  const promos = rows.filter((r) => String(r.promo) === '1' && text(r.id) && text(r.image));
  const setByName = new Map(sets.map((s) => [s.name.toLowerCase(), s]));
  const base = new Map(printings.map((p) => [dotggKey(p), p]));

  // Promo-Sets: zu einem normalen Set (nach Set-Name) oder eigenständig
  const prefixesOf = new Map<string, Set<string>>();
  for (const r of promos) {
    const name = text(r.set_name);
    if (setByName.has(name.toLowerCase())) continue;
    prefixesOf.set(name, (prefixesOf.get(name) ?? new Set()).add(splitPromoId(text(r.id)).prefix));
  }
  const promoSets = new Map<string, CardSet>();
  const setFor = (setName: string): CardSet => {
    const main = setByName.get(setName.toLowerCase());
    const code = main ? `${main.code}X` : commonPrefix([...(prefixesOf.get(setName) ?? [])].sort());
    let set = promoSets.get(code);
    if (!set) {
      set = { setId: code, code, name: main ? `${main.name} Promos` : setName, promo: true, ...(main?.releaseDate ? { releaseDate: main.releaseDate } : {}) };
      promoSets.set(code, set);
    }
    return set;
  };

  const out: Printing[] = [];
  const seen = new Set<string>();
  for (const r of promos) {
    const id = text(r.id);
    const printingId = `dotgg-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (seen.has(printingId)) continue;
    seen.add(printingId);
    const set = setFor(text(r.set_name));
    const { prefix, number } = splitPromoId(id);
    const ownName = text(r.name_normal) || text(r.name).replace(/\s*\([^)]*\)\s*$/, '');
    // Grundkarte: gleiche Nummer ohne Promo-Zusatz („066“ aus „066-P“ oder „066b“, „066a“ aus „066a-P“), gleicher Name
    const m = number.match(/^(R?\d+)([a-z]?)/i);
    const from = (m ? [m[1] + m[2], m[1]] : [])
      .map((n) => base.get(dotggKey({ setCode: prefix, collectorNumber: n })))
      .find((p) => p && sameName(ownName, p.cardName));
    const finishes: Finish[] = [...(String(r.hasNormal) === '1' ? ['normal' as const] : []), ...(String(r.hasFoil) === '1' ? ['foil' as const] : [])];
    const image = text(r.image);
    const event = promoEvent(text(r.name));
    out.push({
      printingId,
      cardName: from?.cardName ?? ownName,
      ...(from?.names ? { names: from.names } : {}),
      setCode: set.code,
      collectorNumber: number,
      variant: 'promo',
      finishes: finishes.length ? finishes : (from?.finishes ?? ['foil']),
      texts: from?.texts ?? { en: `${ownName} ${plain(text(r.effect))}`.trim() },
      rarity: text(r.rarity) || from?.rarity,
      type: from?.type ?? (Array.isArray(r.type) ? (r.type as string[]).join(' / ') : undefined),
      imageUrl: image,
      thumbUrl: image,
      attributes: { ...(from?.attributes ?? {}), ...(event ? { event } : {}) },
      externalIds: { dotgg: id, imageSource: image, ...(from ? { base: from.printingId } : {}) },
    });
  }
  return { sets: [...promoSets.values()], printings: out };
}
