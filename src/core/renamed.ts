import type { Printing } from './types';

/**
 * Karten, deren Druck-ID es im Katalog nicht mehr gibt.
 *
 * Die IDs der Promokarten kommen aus der dotgg-Liste („OGN-247-KDA-P“ → `dotgg-ogn-247-kda-p`). Benennt dotgg
 * eine Promo um – die K/DA-Karten liefen erst unter ihrer Grundkarte (OGN-247-KDA-P) und später als eigenes
 * Set (KDA-003-P) –, zeigt eine gespeicherte Karte sonst nur noch ihre rohe ID und landet unter „Ohne Set“.
 * Aus der alten ID lassen sich Grundkarte (Set + Nummer) und Zusatz („kda“) lesen; damit findet sich der neue
 * Druck wieder.
 */

interface OldDotggId {
  setCode: string;
  number: string;
  /** Zusätze hinter der Nummer, ohne das Promo-„p“ am Ende, z. B. ['kda']. */
  tags: string[];
}

function parseDotggId(id: string): OldDotggId | undefined {
  const m = id.match(/^dotgg-([a-z0-9]+)-([a-z]?\d+[a-z]?)((?:-[a-z0-9]+)*)$/);
  if (!m) return undefined;
  const rest = m[3].split('-').filter(Boolean);
  if (rest[rest.length - 1] === 'p') rest.pop();
  return { setCode: m[1].toUpperCase(), number: m[2], tags: rest };
}

const plain = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const tokens = (p: Printing) => new Set([...p.printingId.toLowerCase().split('-'), p.setCode.toLowerCase()]);

/** Grundkarte einer alten dotgg-ID: gleiches Set, gleiche Nummer (ohne führende Nullen verglichen). */
function baseOf(old: OldDotggId, printings: Printing[]): Printing | undefined {
  const num = old.number.replace(/^0+/, '').toLowerCase();
  const same = (p: Printing) => p.collectorNumber.replace(/^0+/, '').toLowerCase() === num;
  return (
    printings.find((p) => p.setCode === old.setCode && p.variant !== 'promo' && same(p)) ??
    printings.find((p) => p.setCode === old.setCode && same(p))
  );
}

/**
 * Neuer Druck zu einer alten, nicht mehr bekannten dotgg-ID: eine Promo mit dem Namen der Grundkarte, deren
 * ID oder Set jeden Zusatz der alten ID trägt. Nur ein eindeutiger Treffer zählt.
 */
export function renamedPrinting(id: string, printings: Printing[]): Printing | undefined {
  const old = parseDotggId(id);
  if (!old || !old.tags.length) return undefined;
  const base = baseOf(old, printings);
  if (!base) return undefined;
  const name = plain(base.cardName);
  const hits = printings.filter((p) => {
    if (p.printingId === id || p.variant !== 'promo' || plain(p.cardName) !== name) return false;
    const t = tokens(p);
    return old.tags.every((tag) => t.has(tag));
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Ersatz zum Anzeigen, wenn sich kein neuer Druck findet: Name, Texte und Bild der Grundkarte, einsortiert
 * bei deren Promos (sonst beim Set der Grundkarte), Nummer mit Zusatz („247-KDA“).
 */
export function orphanPrinting(id: string, printings: Printing[]): Printing | undefined {
  const old = parseDotggId(id);
  if (!old) return undefined;
  const base = baseOf(old, printings);
  if (!base) return undefined;
  const promoSet = printings.find((p) => p.variant === 'promo' && p.externalIds?.base === base.printingId)?.setCode;
  const promo = id.endsWith('-p');
  return {
    ...base,
    printingId: id,
    setCode: promo ? (promoSet ?? base.setCode) : base.setCode,
    collectorNumber: [old.number, ...old.tags.map((t) => t.toUpperCase())].join('-'),
    variant: promo ? 'promo' : base.variant,
    externalIds: { base: base.printingId },
  };
}

/** Katalogsuche mit Rückfall für umbenannte Drucke: erst der neue Druck, sonst ein Ersatz zum Anzeigen. */
export function lookupWithRenames(byId: Map<string, Printing>, printings: Printing[]): (id: string) => Printing | undefined {
  const cache = new Map<string, Printing | undefined>();
  return (id) => {
    const known = byId.get(id);
    if (known) return known;
    if (!cache.has(id)) cache.set(id, renamedPrinting(id, printings) ?? orphanPrinting(id, printings));
    return cache.get(id);
  };
}
