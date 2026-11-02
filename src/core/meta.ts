import {
  byCost,
  copiesOf,
  DECK_RULES,
  fitsLegend,
  room,
  sideRoom,
  runesFor,
  battlefieldsOf,
  type Deck,
  type DeckCard,
  type DeckPool,
} from './deck';

/**
 * Turnier-Meta: Decklisten, die bei Turnieren vorne gelandet sind, pro Spiel eine Datei `data/<gameId>/meta.json`.
 * Der Katalog-Build holt sie täglich (scripts/build-meta.ts); die App baut daraus Deckvorschläge.
 */
export interface MetaDeck {
  /** Kennung bei der Quelle. */
  id: string;
  /** Turnier, z. B. „Convergence IV“. */
  event: string;
  /** Platzierung im Turnier, 1 = Sieg. */
  place?: number;
  /** Tag des Turniers (ISO-Datum). */
  date: string;
  /** Alle Karten der Liste mit Anzahl, als Druck-ID aus unserem Katalog: Legende, Champion, Hauptdeck, Runen, Battlefields. */
  cards: Record<string, number>;
  /** Sideboard, falls angegeben. */
  side?: Record<string, number>;
  /** Kein Turnierdeck, sondern ein veröffentlichtes Deck der Community (nur bei Legenden mit wenigen Turnierlisten). */
  community?: true;
}

export interface MetaFile {
  gameId: string;
  /** z. B. „riftbound.gg“ */
  source: string;
  sourceUrl: string;
  builtAt: string;
  /** Nur Listen bis zu dieser Platzierung. */
  maxPlace: number;
  decks: MetaDeck[];
}

export async function loadMeta(baseUrl: string, gameId: string): Promise<MetaFile | null> {
  try {
    const res = await fetch(`${baseUrl}data/${gameId}/meta.json`, { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as MetaFile) : null;
  } catch {
    return null;
  }
}

/** Eine Turnierliste in Karten des Deckbaus übersetzt. */
interface Listing {
  deck: MetaDeck;
  weight: number;
  /** Karte → Anzahl (Drucke derselben Karte zusammengezählt). */
  counts: Map<string, number>;
  side: Map<string, number>;
}

export interface MetaStats {
  legend: DeckCard;
  /** Turnierlisten dieser Legende. */
  decks: number;
  /** Mitgezählte Community-Decks (nur wenn es wenige Turnierlisten gibt). */
  community: number;
  /** Die Turnierlisten selbst, beste Platzierung zuerst, dann die neuesten. */
  lists: MetaDeck[];
  /** Turniere, aus denen sie stammen. */
  events: number;
  /** Beste Platzierung und wo. */
  best?: { place: number; event: string; date: string };
  newest?: string;
  oldest?: string;
  /** Gewichteter Anteil der Listen, die die Karte mindestens k-mal spielen: share[id][k-1]. */
  share: Map<string, number[]>;
  /** Wie oft die Karte im Schnitt als Chosen Champion denkbar ist: Anteil der Listen mit dieser Champion-Einheit. */
  champions: Map<string, number>;
  /** Mittlere Anzahl je Rune. */
  runes: Map<string, number>;
  /** Anteil der Listen mit diesem Battlefield. */
  battlefields: Map<string, number>;
  /** Wie share, fürs Sideboard. */
  side: Map<string, number[]>;
}

/** Ab so vielen Turnierlisten zählen Community-Decks nicht mehr mit. */
export const ENOUGH_LISTS = 15;
/** Community-Decks zählen weniger als Turnierlisten: niemand hat sie im Turnier erprobt. */
export const COMMUNITY_WEIGHT = 0.3;

const DAY = 864e5;
/** Nach so vielen Tagen zählt eine Liste nur noch halb: die Meta ändert sich mit jedem Set. */
export const HALF_LIFE_DAYS = 30;

/**
 * Gewicht einer Liste: neuere zählen mehr (Halbwertszeit 30 Tage), bessere Plätze mehr
 * (Sieg 1, Platz 8 etwa 0,6, Platz 32 etwa 0,4).
 */
export function deckWeight(deck: Pick<MetaDeck, 'date' | 'place' | 'community'>, now: number): number {
  const age = Math.max(0, (now - Date.parse(deck.date)) / DAY);
  const recency = 0.5 ** (age / HALF_LIFE_DAYS);
  if (deck.community) return recency * COMMUNITY_WEIGHT;
  const placement = 1 / (1 + 0.25 * Math.log2(Math.max(1, deck.place ?? 32)));
  return recency * placement;
}

/** Listen nach Legende, mit Karten des Deckbaus statt Drucken. */
function listings(meta: MetaFile, pool: DeckPool, now: number): Map<string, Listing[]> {
  const byLegend = new Map<string, Listing[]>();
  for (const deck of meta.decks) {
    const counts = new Map<string, number>();
    let legend: string | undefined;
    for (const [printingId, n] of Object.entries(deck.cards)) {
      const card = pool.cardOf(printingId);
      if (!card || !(n > 0)) continue;
      if (card.kind === 'legend') legend = card.id;
      counts.set(card.id, (counts.get(card.id) ?? 0) + n);
    }
    if (!legend) continue;
    const side = new Map<string, number>();
    for (const [printingId, n] of Object.entries(deck.side ?? {})) {
      const card = pool.cardOf(printingId);
      if (card && n > 0) side.set(card.id, (side.get(card.id) ?? 0) + n);
    }
    const list = byLegend.get(legend) ?? [];
    list.push({ deck, weight: deckWeight(deck, now), counts, side });
    byLegend.set(legend, list);
  }
  return byLegend;
}

/** Wie viele Turnierlisten es je Legende gibt (für die Legendenauswahl). */
export function metaCounts(meta: MetaFile | null, pool: DeckPool): Map<string, number> {
  const counts = new Map<string, number>();
  if (!meta) return counts;
  for (const [legend, list] of listings(meta, pool, Date.now())) {
    const n = list.filter((l) => !l.deck.community).length;
    if (n) counts.set(legend, n);
  }
  return counts;
}

/** Was die Turnierlisten einer Legende gemeinsam haben. */
export function metaStats(meta: MetaFile | null, legend: DeckCard, pool: DeckPool, now = Date.now()): MetaStats | null {
  const all = meta ? listings(meta, pool, now).get(legend.id) : undefined;
  if (!all?.length) return null;
  // Genug Turnierlisten: nur die; sonst helfen Community-Decks, die Kartenwahl abzusichern
  const tournament = all.filter((l) => !l.deck.community);
  const list = tournament.length >= ENOUGH_LISTS ? tournament : all;
  const total = list.reduce((s, l) => s + l.weight, 0);
  const share = new Map<string, number[]>();
  const champions = new Map<string, number>();
  const runes = new Map<string, number>();
  const battlefields = new Map<string, number>();
  const side = new Map<string, number[]>();
  for (const { weight, counts, side: board } of list) {
    const w = weight / total;
    for (const [id, n] of board) {
      const s = side.get(id) ?? [0, 0, 0];
      for (let k = 0; k < Math.min(n, DECK_RULES.copies); k++) s[k] += w;
      side.set(id, s);
    }
    for (const [id, n] of counts) {
      const card = pool.cards.get(id)!;
      if (card.kind === 'rune') runes.set(id, (runes.get(id) ?? 0) + n * w);
      else if (card.kind === 'battlefield') battlefields.set(id, (battlefields.get(id) ?? 0) + w);
      else if (card.kind !== 'legend') {
        const s = share.get(id) ?? [0, 0, 0];
        for (let k = 0; k < Math.min(n, DECK_RULES.copies); k++) s[k] += w;
        share.set(id, s);
        if (card.champion && card.championOf === legend.championOf) champions.set(id, (champions.get(id) ?? 0) + w);
      }
    }
  }
  let best: MetaStats['best'];
  for (const { deck } of tournament) {
    if (deck.place && (!best || deck.place < best.place || (deck.place === best.place && deck.date > best.date))) best = { place: deck.place, event: deck.event, date: deck.date };
  }
  const dates = list.map((l) => l.deck.date).sort();
  const lists = tournament.map((l) => l.deck).sort(byPlacement);
  return {
    legend,
    decks: tournament.length,
    community: list.length - tournament.length,
    lists,
    events: new Set(tournament.map((l) => l.deck.event)).size,
    best,
    newest: dates.at(-1),
    oldest: dates[0],
    share,
    champions,
    runes,
    battlefields,
    side,
  };
}

/** Turnierlisten sortiert: beste Platzierung zuerst, bei gleichem Platz die neueste. */
export function byPlacement(a: MetaDeck, b: MetaDeck): number {
  return (a.place ?? Number.MAX_SAFE_INTEGER) - (b.place ?? Number.MAX_SAFE_INTEGER) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
}

/** Champion, den die meisten Listen spielen (unter denen, die zur Legende passen). */
export function metaChampion(stats: MetaStats, choices: DeckCard[]): DeckCard | undefined {
  return [...choices].sort((a, b) => (stats.champions.get(b.id) ?? 0) - (stats.champions.get(a.id) ?? 0))[0];
}

export interface MetaOptions {
  /** Besitz je Karte; bei preferOwned rücken eigene Karten nach vorn, wenn sie fast genauso oft gespielt werden. */
  owned?: Map<string, number>;
  preferOwned?: boolean;
}

/** So viel Vorsprung (Anteil der Listen) bekommt eine Kopie, die man schon besitzt. */
export const OWNED_BONUS = 0.15;

/**
 * Deck aus der Meta bauen: Legende und Chosen Champion bleiben, Hauptdeck, Runen und Battlefields kommen neu.
 *
 * Hauptdeck wie eine „Durchschnittsliste“: Jede Kopie einer Karte (1., 2., 3.) bekommt den Anteil der Listen,
 * die mindestens so viele Kopien spielen. Die 39 Kopien mit den höchsten Anteilen kommen ins Deck (dazu der
 * Champion), so landen Karten, die fast alle spielen, mit voller Anzahl drin, und Lücken füllen die nächstbesten.
 */
export function buildFromMeta(deck: Deck, stats: MetaStats, pool: DeckPool, options: MetaOptions = {}): Deck {
  const legend = stats.legend;
  const owned = options.owned ?? new Map<string, number>();
  const bonus = (id: string, k: number) => (options.preferOwned && (owned.get(id) ?? 0) >= k ? OWNED_BONUS : 0);

  const picks: { card: DeckCard; k: number; score: number }[] = [];
  for (const [id, s] of stats.share) {
    const card = pool.cards.get(id);
    if (!card || !fitsLegend(card, legend)) continue;
    s.forEach((value, i) => value > 0 && picks.push({ card, k: i + 1, score: value + bonus(id, i + 1) }));
  }
  // Höchster Anteil zuerst; bei Gleichstand die niedrigere Kopie, dann günstigere Karte
  picks.sort((a, b) => b.score - a.score || a.k - b.k || (a.card.energy ?? 99) - (b.card.energy ?? 99) || a.card.id.localeCompare(b.card.id));

  let next: Deck = { ...deck, cards: {}, runes: {}, battlefields: [], side: {} };
  const target = DECK_RULES.main - (next.champion ? 1 : 0);
  let count = 0;
  for (const { card, k } of picks) {
    if (count >= target) break;
    // k-te Kopie nur, wenn die (k-1)-te schon drin ist; der Champion zählt mit
    if (copiesOf(next, card.id) !== k - 1 || room(next, card, pool) <= 0) continue;
    next = { ...next, cards: { ...next.cards, [card.id]: (next.cards[card.id] ?? 0) + 1 } };
    count++;
  }

  next = { ...next, runes: metaRunes(stats, runesFor(legend, pool)) };
  const fields = [...stats.battlefields].filter(([id]) => pool.cards.get(id)?.kind === 'battlefield').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const chosen = fields.slice(0, DECK_RULES.battlefields).map(([id]) => id);
  // Zu wenige in den Listen: mit Battlefields aus der Sammlung, sonst alphabetisch auffüllen
  for (const b of [...battlefieldsOf(pool)].sort((a, c) => Number((owned.get(c.id) ?? 0) > 0) - Number((owned.get(a.id) ?? 0) > 0))) {
    if (chosen.length >= DECK_RULES.battlefields) break;
    if (!chosen.includes(b.id)) chosen.push(b.id);
  }
  return fillSide({ ...next, battlefields: chosen }, stats, pool);
}

/** Side Deck aus den Sideboards der Listen: die Kopien, die am häufigsten dabei sind, bis 10 Karten. */
function fillSide(deck: Deck, stats: MetaStats, pool: DeckPool): Deck {
  const picks: { card: DeckCard; k: number; score: number }[] = [];
  for (const [id, s] of stats.side) {
    const card = pool.cards.get(id);
    if (!card || !fitsLegend(card, stats.legend)) continue;
    s.forEach((value, i) => value >= 0.1 && picks.push({ card, k: i + 1, score: value }));
  }
  picks.sort((a, b) => b.score - a.score || a.k - b.k || a.card.id.localeCompare(b.card.id));
  let next = deck;
  for (const { card, k } of picks) {
    if ((next.side?.[card.id] ?? 0) !== k - 1 || sideRoom(next, card) <= 0) continue;
    next = { ...next, side: { ...next.side, [card.id]: k } };
  }
  return next;
}

/**
 * Eine bestimmte Turnierliste übernehmen. Der Chosen Champion bleibt, wenn die Liste ihn spielt,
 * sonst wird es der Champion der Legende, den die Liste am häufigsten spielt.
 */
export function deckFromList(deck: Deck, list: MetaDeck, legend: DeckCard, pool: DeckPool): Deck {
  const cards: Record<string, number> = {};
  const runes: Record<string, number> = {};
  const battlefields: string[] = [];
  for (const [printingId, n] of Object.entries(list.cards)) {
    const card = pool.cardOf(printingId);
    if (!card || card.kind === 'legend' || !(n > 0)) continue;
    if (card.kind === 'rune') runes[card.id] = (runes[card.id] ?? 0) + n;
    else if (card.kind === 'battlefield') battlefields.includes(card.id) || battlefields.push(card.id);
    else cards[card.id] = Math.min(DECK_RULES.copies, (cards[card.id] ?? 0) + n);
  }
  const champions = Object.keys(cards)
    .map((id) => pool.cards.get(id)!)
    .filter((c) => c.champion && c.championOf === legend.championOf)
    .sort((a, b) => cards[b.id] - cards[a.id] || byCost(a, b));
  const champion = cards[deck.champion] ? deck.champion : champions[0]?.id ?? deck.champion;
  if (cards[champion]) {
    cards[champion]--;
    if (!cards[champion]) delete cards[champion];
  }
  const side: Record<string, number> = {};
  for (const [printingId, n] of Object.entries(list.side ?? {})) {
    const card = pool.cardOf(printingId);
    if (card && n > 0 && card.kind !== 'legend') side[card.id] = Math.min(DECK_RULES.copies, (side[card.id] ?? 0) + n);
  }
  return { ...deck, champion, cards, runes, battlefields: battlefields.slice(0, DECK_RULES.battlefields), side };
}

/** 12 Runen im Verhältnis der Listen (größte Reste zuerst); ohne Daten gleichmäßig. */
export function metaRunes(stats: Pick<MetaStats, 'runes'>, runes: DeckCard[]): Record<string, number> {
  const allowed = runes.map((r) => ({ id: r.id, avg: stats.runes.get(r.id) ?? 0 }));
  const sum = allowed.reduce((s, r) => s + r.avg, 0);
  if (!allowed.length) return {};
  const ideal = allowed.map((r) => ({ id: r.id, x: sum > 0 ? (r.avg / sum) * DECK_RULES.runes : DECK_RULES.runes / allowed.length }));
  const counts = ideal.map((r) => ({ id: r.id, n: Math.floor(r.x), rest: r.x - Math.floor(r.x) }));
  let left = DECK_RULES.runes - counts.reduce((s, r) => s + r.n, 0);
  for (const r of [...counts].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    r.n++;
    left--;
  }
  const out: Record<string, number> = {};
  for (const r of counts) if (r.n > 0) out[r.id] = r.n;
  return out;
}

/** Anteil der Listen, die die Karte überhaupt spielen (für die Anzeige „in 87 % der Listen“). */
export function playRate(stats: MetaStats, id: string): number {
  return stats.share.get(id)?.[0] ?? stats.battlefields.get(id) ?? 0;
}
