import { compareCollectorNumbers, setRanks } from './excel';
import type { CardSet, CollectionItem, GameId, Printing } from './types';

/**
 * Deckbau nach den offiziellen Riftbound-Regeln:
 *   - eine Legende (Champion Legend); ihre zwei Domains bestimmen, welche Karten ins Deck dürfen
 *   - Hauptdeck mit mindestens 40 Karten, darin der Chosen Champion: eine Champion-Einheit des Champions der Legende
 *   - höchstens 3 Karten mit gleichem Namen, höchstens 3 Signature-Karten und nur die des eigenen Champions
 *   - nur Karten aus den Domains der Legende (farblose passen in jedes Deck)
 *   - genau 12 Runen aus diesen Domains und 3 verschiedene Battlefields
 */
export const DECK_RULES = { main: 40, copies: 3, signatures: 3, runes: 12, battlefields: 3 } as const;

/** Spiele, für die es Deckbau gibt. */
export const DECK_GAMES: GameId[] = ['riftbound'];

export const COLORLESS = 'Colorless';

export type CardKind = 'legend' | 'unit' | 'spell' | 'gear' | 'rune' | 'battlefield';

export interface DeckCard {
  /** Name im Deck und Grenze für Kopien: Champion-Einheiten mit Titel („Jinx, Rebel“), sonst der Kartenname. */
  id: string;
  name: string;
  /** Titel einer Champion-Einheit, z. B. „Rebel“. */
  title?: string;
  kind: CardKind;
  domains: string[];
  tags: string[];
  /** Champion, zu dem die Karte gehört: bei Legenden und Signature-Karten aus den Schlagwörtern, bei Champions der Name. */
  championOf?: string;
  /** Champion-Einheit (Supertyp Champion). */
  champion: boolean;
  signature: boolean;
  energy: number | null;
  /** Druck für Bild und Preis: normaler Druck aus dem ältesten Set. */
  printing: Printing;
}

export interface DeckPool {
  gameId: GameId;
  cards: Map<string, DeckCard>;
  /** Legenden mit Champion, nach Champion sortiert. */
  legends: DeckCard[];
  /** Karte eines Drucks; alle Drucke einer Karte (auch Showcase und Promos) gehören zur selben. */
  cardOf(printingId: string): DeckCard | undefined;
}

export interface Deck {
  deckId: string;
  gameId: GameId;
  name: string;
  /** Legende (Karten-ID). */
  legend: string;
  /** Chosen Champion; zählt zum Hauptdeck und zu den Kopien seines Namens. */
  champion: string;
  /** Hauptdeck ohne den Chosen Champion: Karte → Anzahl. */
  cards: Record<string, number>;
  runes: Record<string, number>;
  battlefields: string[];
  createdAt: string;
  updatedAt: string;
}

const KINDS: Record<string, CardKind> = { legend: 'legend', unit: 'unit', spell: 'spell', gear: 'gear', rune: 'rune', battlefield: 'battlefield' };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Kartenart eines Drucks; Spielmarken (Token) und Drucke ohne Typ gehören in kein Deck. */
export function kindOf(p: Printing): CardKind | undefined {
  if (strings(p.attributes?.supertypes).includes('Token')) return undefined;
  for (const t of (p.type ?? '').split('/')) {
    const kind = KINDS[t.trim().toLowerCase()];
    if (kind) return kind;
  }
  return undefined;
}

/** Name im Deck: Champion-Einheiten unterscheiden sich nur im Titel („Jinx, Rebel“ und „Jinx, Demolitionist“). */
export function deckCardId(p: Printing): string {
  const title = championTitle(p);
  return title ? `${p.cardName}, ${title}` : p.cardName;
}

function championTitle(p: Printing): string | undefined {
  const subtitle = p.attributes?.subtitle;
  return typeof subtitle === 'string' && subtitle && kindOf(p) === 'unit' && strings(p.attributes?.supertypes).includes('Champion') ? subtitle : undefined;
}

/**
 * Alle Karten eines Spiels für den Deckbau. Je Karte zählt ein Druck (normal, ältestes Set);
 * Showcase-Drucke und Promos derselben Karte zeigen nur, ob man sie besitzt.
 */
export function deckPool(gameId: GameId, printings: Printing[], sets: CardSet[]): DeckPool {
  const ranks = setRanks(sets);
  const promoSets = new Set(sets.filter((s) => s.promo).map((s) => s.code));
  const preference = (p: Printing) => (p.variant === 'normal' ? 0 : 1) + (promoSets.has(p.setCode) || p.variant === 'promo' ? 2 : 0);
  const better = (a: Printing, b: Printing) =>
    preference(a) - preference(b) ||
    (ranks.get(a.setCode) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.setCode) ?? Number.MAX_SAFE_INTEGER) ||
    compareCollectorNumbers(a.collectorNumber, b.collectorNumber);

  const best = new Map<string, Printing>();
  const byPrinting = new Map<string, string>();
  for (const p of printings) {
    if (!kindOf(p)) continue;
    const id = deckCardId(p);
    byPrinting.set(p.printingId, id);
    const current = best.get(id);
    if (!current || better(p, current) < 0) best.set(id, p);
  }

  const championNames = new Set<string>();
  for (const p of best.values()) if (championTitle(p)) championNames.add(p.cardName);

  const cards = new Map<string, DeckCard>();
  for (const [id, p] of best) {
    const kind = kindOf(p)!;
    const supertypes = strings(p.attributes?.supertypes);
    const tags = strings(p.attributes?.tags);
    const title = championTitle(p);
    const energy = p.attributes?.energy;
    cards.set(id, {
      id,
      name: p.cardName,
      ...(title ? { title } : {}),
      kind,
      domains: strings(p.attributes?.domains),
      tags,
      championOf: title ? p.cardName : tags.find((t) => championNames.has(t)),
      champion: !!title,
      signature: supertypes.includes('Signature'),
      energy: typeof energy === 'number' ? energy : null,
      printing: p,
    });
  }
  const legends = [...cards.values()]
    .filter((c) => c.kind === 'legend')
    .sort((a, b) => (a.championOf ?? a.name).localeCompare(b.championOf ?? b.name) || a.name.localeCompare(b.name));
  return { gameId, cards, legends, cardOf: (printingId) => cards.get(byPrinting.get(printingId) ?? '') };
}

/** Darf die Karte ins Hauptdeck dieser Legende? (Domains der Legende, nur ihre Signature-Karten) */
export function fitsLegend(card: DeckCard, legend: DeckCard): boolean {
  if (card.kind === 'legend' || card.kind === 'rune' || card.kind === 'battlefield') return false;
  if (card.signature && (!legend.championOf || card.championOf !== legend.championOf)) return false;
  return card.domains.every((d) => d === COLORLESS || legend.domains.includes(d));
}

/** Champion-Einheiten, die als Chosen Champion zur Legende passen. */
export function championsFor(legend: DeckCard, pool: DeckPool): DeckCard[] {
  return [...pool.cards.values()].filter((c) => c.champion && c.championOf === legend.championOf && fitsLegend(c, legend)).sort(byCost);
}

/** Karten, die ins Hauptdeck dieser Legende dürfen. */
export function mainCardsFor(legend: DeckCard, pool: DeckPool): DeckCard[] {
  return [...pool.cards.values()].filter((c) => fitsLegend(c, legend)).sort(byCost);
}

/** Runen aus den Domains der Legende. */
export function runesFor(legend: DeckCard, pool: DeckPool): DeckCard[] {
  return [...pool.cards.values()]
    .filter((c) => c.kind === 'rune' && c.domains.some((d) => legend.domains.includes(d)))
    .sort((a, b) => legend.domains.indexOf(a.domains[0]) - legend.domains.indexOf(b.domains[0]));
}

export function battlefieldsOf(pool: DeckPool): DeckCard[] {
  return [...pool.cards.values()].filter((c) => c.kind === 'battlefield').sort((a, b) => a.name.localeCompare(b.name));
}

/** Nach Kosten, dann Name. */
export function byCost(a: DeckCard, b: DeckCard): number {
  return (a.energy ?? 99) - (b.energy ?? 99) || a.id.localeCompare(b.id);
}

export function newDeck(gameId: GameId, legend: DeckCard, champion: DeckCard, deckId: string, now: string): Deck {
  return {
    deckId,
    gameId,
    name: legend.championOf ?? legend.name,
    legend: legend.id,
    champion: champion.id,
    cards: {},
    runes: {},
    battlefields: [],
    createdAt: now,
    updatedAt: now,
  };
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((n, c) => n + c, 0);

/** Kopien eines Namens im Hauptdeck, der Chosen Champion mitgezählt. */
export function copiesOf(deck: Deck, cardId: string): number {
  return (deck.cards[cardId] ?? 0) + (deck.champion === cardId ? 1 : 0);
}

export function mainCount(deck: Deck): number {
  return sum(deck.cards) + (deck.champion ? 1 : 0);
}

export function runeCount(deck: Deck): number {
  return sum(deck.runes);
}

export function signatureCount(deck: Deck, pool: DeckPool): number {
  let n = 0;
  for (const [id, count] of Object.entries(deck.cards)) if (pool.cards.get(id)?.signature) n += count;
  if (pool.cards.get(deck.champion)?.signature) n++;
  return n;
}

/** Wie viele Kopien noch dazukommen dürfen (Kopien je Name, Signature-Karten gesamt). */
export function room(deck: Deck, card: DeckCard, pool: DeckPool): number {
  const copies = DECK_RULES.copies - copiesOf(deck, card.id);
  return Math.max(0, card.signature ? Math.min(copies, DECK_RULES.signatures - signatureCount(deck, pool)) : copies);
}

/** Anzahl einer Karte im Hauptdeck ändern; nie unter 0 oder über die Grenzen. */
export function withCard(deck: Deck, card: DeckCard, delta: number, pool: DeckPool): Deck {
  const current = deck.cards[card.id] ?? 0;
  const next = Math.max(0, current + Math.min(delta, room(deck, card, pool)));
  if (next === current) return deck;
  const cards = { ...deck.cards };
  if (next) cards[card.id] = next;
  else delete cards[card.id];
  return { ...deck, cards };
}

/**
 * Anzahl einer Rune ändern. Sind schon alle 12 Runen gewählt, wandert eine von einer anderen Rune herüber,
 * so lässt sich die Aufteilung mit einem Tipp verschieben.
 */
export function withRune(deck: Deck, rune: DeckCard, delta: number, runes: DeckCard[] = []): Deck {
  const counts = { ...deck.runes };
  const add = (id: string, n: number) => {
    const next = (counts[id] ?? 0) + n;
    if (next > 0) counts[id] = next;
    else delete counts[id];
  };
  if (delta < 0) {
    if (!counts[rune.id]) return deck;
    add(rune.id, -1);
  } else if (runeCount(deck) < DECK_RULES.runes) {
    add(rune.id, 1);
  } else {
    const donor = runes.find((r) => r.id !== rune.id && (counts[r.id] ?? 0) > 0);
    if (!donor) return deck;
    add(donor.id, -1);
    add(rune.id, 1);
  }
  return { ...deck, runes: counts };
}

/** 12 Runen gleichmäßig auf die Runen der Legende verteilen (bei zwei Domains 6 und 6). */
export function evenRunes(deck: Deck, runes: DeckCard[]): Deck {
  if (!runes.length) return deck;
  const counts: Record<string, number> = {};
  runes.forEach((r, i) => {
    const n = Math.floor(DECK_RULES.runes / runes.length) + (i < DECK_RULES.runes % runes.length ? 1 : 0);
    if (n) counts[r.id] = n;
  });
  return { ...deck, runes: counts };
}

/** Battlefield wählen oder abwählen; mehr als drei gehen nicht. */
export function toggleBattlefield(deck: Deck, battlefield: DeckCard): Deck {
  if (deck.battlefields.includes(battlefield.id)) return { ...deck, battlefields: deck.battlefields.filter((b) => b !== battlefield.id) };
  if (deck.battlefields.length >= DECK_RULES.battlefields) return deck;
  return { ...deck, battlefields: [...deck.battlefields, battlefield.id] };
}

/** Anderer Chosen Champion: eine Kopie des neuen wandert aus dem Deck in den Champion-Platz, damit die Grenze von 3 hält. */
export function withChampion(deck: Deck, champion: DeckCard): Deck {
  if (deck.champion === champion.id) return deck;
  const cards = { ...deck.cards };
  if (cards[champion.id]) {
    cards[champion.id]--;
    if (!cards[champion.id]) delete cards[champion.id];
  }
  return { ...deck, champion: champion.id, cards };
}

export interface DeckCheck {
  main: number;
  runes: number;
  battlefields: number;
  signatures: number;
  /** Was noch fehlt oder gegen die Regeln verstößt, kurz und auf Deutsch. */
  problems: string[];
  complete: boolean;
}

export function checkDeck(deck: Deck, pool: DeckPool): DeckCheck {
  const main = mainCount(deck);
  const runes = runeCount(deck);
  const signatures = signatureCount(deck, pool);
  const problems: string[] = [];
  const legend = pool.cards.get(deck.legend);
  const champion = pool.cards.get(deck.champion);
  if (!legend) problems.push('Legende nicht im Katalog');
  if (!champion) problems.push('Champion fehlt');
  else if (legend && (!champion.champion || champion.championOf !== legend.championOf)) problems.push(`${champion.id} passt nicht zur Legende`);
  if (main < DECK_RULES.main) problems.push(`Noch ${DECK_RULES.main - main} ${DECK_RULES.main - main === 1 ? 'Karte' : 'Karten'}`);
  for (const id of Object.keys(deck.cards)) {
    const card = pool.cards.get(id);
    if (!card) problems.push(`${id} nicht im Katalog`);
    else if (legend && !fitsLegend(card, legend)) problems.push(`${id} passt nicht zur Legende`);
    if (copiesOf(deck, id) > DECK_RULES.copies) problems.push(`${id} mehr als ${DECK_RULES.copies}×`);
  }
  if (signatures > DECK_RULES.signatures) problems.push(`Mehr als ${DECK_RULES.signatures} Signature-Karten`);
  if (runes < DECK_RULES.runes) problems.push(`Noch ${DECK_RULES.runes - runes} ${DECK_RULES.runes - runes === 1 ? 'Rune' : 'Runen'}`);
  if (runes > DECK_RULES.runes) problems.push(`${runes - DECK_RULES.runes} ${runes - DECK_RULES.runes === 1 ? 'Rune' : 'Runen'} zu viel`);
  for (const id of Object.keys(deck.runes)) {
    const rune = pool.cards.get(id);
    if (legend && rune && !rune.domains.some((d) => legend.domains.includes(d))) problems.push(`${id} passt nicht zur Legende`);
  }
  const battlefields = new Set(deck.battlefields).size;
  if (battlefields < DECK_RULES.battlefields) {
    const n = DECK_RULES.battlefields - battlefields;
    problems.push(`Noch ${n} ${n === 1 ? 'Battlefield' : 'Battlefields'}`);
  }
  return { main, runes, battlefields, signatures, problems, complete: !problems.length };
}

/** Alle Karten des Decks mit Anzahl: Legende, Champion, Hauptdeck, Runen, Battlefields. */
export function deckEntries(deck: Deck): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  const add = (id: string, n: number) => id && counts.set(id, (counts.get(id) ?? 0) + n);
  add(deck.legend, 1);
  add(deck.champion, 1);
  for (const [id, n] of Object.entries(deck.cards)) add(id, n);
  for (const [id, n] of Object.entries(deck.runes)) add(id, n);
  for (const id of deck.battlefields) add(id, 1);
  return [...counts].map(([id, count]) => ({ id, count }));
}

/** Besitz je Karte: alle Drucke, Sprachen und Ausführungen zusammen. */
export function ownedByCard(items: CollectionItem[], pool: DeckPool): Map<string, number> {
  const owned = new Map<string, number>();
  for (const item of items) {
    if (item.gameId !== pool.gameId) continue;
    const card = pool.cardOf(item.printingId);
    if (card) owned.set(card.id, (owned.get(card.id) ?? 0) + item.quantity);
  }
  return owned;
}

/** Wie viele Karten des Decks man (noch) nicht besitzt. */
export function missingCount(deck: Deck, owned: Map<string, number>): number {
  return deckEntries(deck).reduce((n, e) => n + Math.max(0, e.count - (owned.get(e.id) ?? 0)), 0);
}

/** Wert des Decks mit dem Preis des gezeigten Drucks je Karte; undefined, wenn keine Karte einen Preis hat. */
export function deckValue(deck: Deck, pool: DeckPool, priceOf: (card: DeckCard) => number | undefined): number | undefined {
  let total: number | undefined;
  for (const { id, count } of deckEntries(deck)) {
    const card = pool.cards.get(id);
    const price = card && priceOf(card);
    if (price !== undefined) total = (total ?? 0) + price * count;
  }
  return total;
}
