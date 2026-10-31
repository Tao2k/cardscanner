import type { CardSet, Finish, Printing, Variant } from '../../src/core/types';
import { dotggKey, sameName } from './riftbound-prices';
import { plain, type DotggRow } from './riftbound-promos';

/**
 * Riots Galerie ist nicht vollständig: Es fehlen u. a. die Signature-Drucke neuer Sets (Radiance *),
 * die Runen ab Spiritforged und viele Spielmarken; bei einigen neuen Karten fehlt außerdem der Kartentyp.
 * Die Kartenliste von dotgg führt diese Karten. Hier kommen sie in ihr normales Set (nicht in die Promos)
 * und lückenhafte Galerie-Karten bekommen Typ, Domains und Schlagwörter von dotgg.
 */

const text = (v: unknown) => (typeof v === 'string' && v !== 'null' ? v : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface DomainFix {
  printingId: string;
  card: string;
  from: string[];
  to: string[];
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** „RAD-179-STAR“ → Set „RAD“, Nummer „179*“ (wie in der Galerie); „SFD-R04a“ → „R04a“. */
export function splitDotggId(id: string): { setCode: string; number: string } {
  const [setCode, ...rest] = id.split('-');
  const number = rest.join('-').replace(/-STAR$/i, '*');
  return { setCode, number };
}

function variantOf(number: string, setMax?: number): Variant {
  if (number.endsWith('*')) return 'signature';
  if (/^[A-Z]?\d+[a-z]$/.test(number)) return 'alt_art';
  const n = Number(number);
  if (setMax && Number.isInteger(n) && n > setMax) return 'overnumbered';
  return 'normal';
}

/** Werte für den Deckbau aus einer dotgg-Zeile (Kosten, Domains, Supertyp, Schlagwörter). */
function dotggAttributes(r: DotggRow): Record<string, unknown> {
  const supertype = text(r.supertype);
  return {
    energy: num(r.cost),
    might: num(r.might),
    power: num(r.power),
    domains: list(r.color),
    supertypes: supertype ? [supertype] : [],
    tags: list(r.tags),
  };
}

/**
 * Ergänzt den Galerie-Katalog um die Karten, die nur dotgg kennt, und füllt fehlende Kartentypen auf.
 * `setMax` = höchste reguläre Nummer je Set (für Overnumbered).
 */
export function completeCatalog(
  rows: DotggRow[],
  sets: CardSet[],
  printings: Printing[],
  setMax: Map<string, number | undefined> = new Map(),
): { printings: Printing[]; added: Printing[]; repaired: string[]; domainFixes: DomainFix[] } {
  const mainSets = new Set(sets.filter((s) => !s.promo).map((s) => s.code));
  const regular = rows.filter((r) => String(r.promo) !== '1' && text(r.id) && text(r.image));
  const byKey = new Map(regular.map((r) => [dotggKey({ setCode: splitDotggId(text(r.id)).setCode, collectorNumber: splitDotggId(text(r.id)).number }), r]));

  // 1. Galerie-Karten ohne Kartentyp mit dotgg-Daten auffüllen; falsche Domains korrigieren.
  //    Riot hat bei vielen Radiance-Karten die Domain falsch eingetragen (Bilgewater Tracker: Body statt Fury),
  //    dotgg stimmt mit den gedruckten Karten überein. Weicht die Galerie ab, gilt dotgg.
  const repaired: string[] = [];
  const domainFixes: DomainFix[] = [];
  const fixed = printings.map((p) => {
    const r = byKey.get(dotggKey(p));
    if (!r || !sameName(text(r.name), p.cardName)) return p;
    const attrs = p.attributes ?? {};
    let out = p;
    const theirs = list(r.color);
    const ours = Array.isArray(attrs.domains) ? (attrs.domains as string[]) : [];
    if (theirs.length && !sameSet(theirs, ours)) {
      domainFixes.push({ printingId: p.printingId, card: `${p.setCode}-${p.collectorNumber} ${p.cardName}`, from: ours, to: theirs });
      out = { ...out, attributes: { ...out.attributes, domains: theirs } };
    }
    const type = list(r.type).join(' / ');
    if (p.type || !type) return out;
    repaired.push(p.printingId);
    const extra = dotggAttributes(r);
    const now = out.attributes ?? {};
    const keep = (k: string) => {
      const v = now[k];
      return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
    };
    return { ...out, type, attributes: { ...now, ...Object.fromEntries(Object.entries(extra).filter(([k]) => !keep(k))) } };
  });

  // 2. Karten, die in der Galerie ganz fehlen
  const known = new Set(fixed.map((p) => dotggKey(p)));
  const base = new Map(fixed.map((p) => [dotggKey(p), p]));
  const added: Printing[] = [];
  for (const r of regular) {
    const id = text(r.id);
    const { setCode, number } = splitDotggId(id);
    if (!mainSets.has(setCode)) continue;
    const key = dotggKey({ setCode, collectorNumber: number });
    if (known.has(key)) continue;
    known.add(key);
    const ownName = text(r.name_normal) || text(r.name);
    // Grundkarte für Signature- und Alt-Art-Drucke: gleiche Nummer ohne * bzw. Buchstabe, gleicher Name
    const plainNumber = number.replace(/\*$/, '').replace(/^([A-Z]?\d+)[a-z]$/, '$1');
    const from = plainNumber !== number ? base.get(dotggKey({ setCode, collectorNumber: plainNumber })) : undefined;
    const twin = from && sameName(ownName, from.cardName) ? from : undefined;
    const finishes: Finish[] = [...(String(r.hasNormal) === '1' ? ['normal' as const] : []), ...(String(r.hasFoil) === '1' ? ['foil' as const] : [])];
    const image = text(r.image);
    const variant = variantOf(number, setMax.get(setCode));
    added.push({
      printingId: `dotgg-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      cardName: twin?.cardName ?? ownName,
      ...(twin?.names ? { names: twin.names } : {}),
      setCode,
      collectorNumber: number,
      variant,
      finishes: finishes.length ? finishes : variant === 'normal' ? ['normal', 'foil'] : ['foil'],
      texts: twin?.texts ?? { en: `${ownName} ${plain(text(r.effect))}`.trim() },
      rarity: text(r.rarity) || twin?.rarity,
      type: twin?.type ?? (list(r.type).join(' / ') || undefined),
      imageUrl: image,
      thumbUrl: image,
      attributes: { ...(twin?.attributes ?? { ...dotggAttributes(r), orientation: list(r.type).includes('Battlefield') ? 'landscape' : 'portrait' }) },
      externalIds: { dotgg: id, imageSource: image, ...(twin ? { base: twin.printingId } : {}) },
    });
  }
  return { printings: [...fixed, ...added], added, repaired, domainFixes };
}
