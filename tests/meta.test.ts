import { describe, expect, it } from 'vitest';
import { checkDeck, copiesOf, deckPool, mainCount, newDeck, type DeckCard } from '../src/core/deck';
import { buildFromMeta, byPlacement, deckFromList, deckWeight, metaChampion, metaCounts, metaRunes, metaStats, playRate, type MetaDeck, type MetaFile } from '../src/core/meta';
import { dotggIndex, hasLegend, toMetaDeck } from '../scripts/adapters/riftbound-meta';
import type { CardSet, Printing } from '../src/core/types';

const SETS: CardSet[] = [{ setId: 'OGN', code: 'OGN', name: 'Origins', releaseDate: '2025-10-31' }];

let n = 0;
function card(name: string, type: string, domains: string[], extra: { subtitle?: string; supertypes?: string[]; tags?: string[]; energy?: number; id?: string; variant?: Printing['variant']; no?: string } = {}): Printing {
  const id = extra.id ?? `p${++n}`;
  return {
    printingId: id,
    cardName: name,
    setCode: 'OGN',
    collectorNumber: extra.no ?? String(++n),
    variant: extra.variant ?? 'normal',
    type,
    imageUrl: `https://cdn.test/${id}.png`,
    attributes: { domains, supertypes: extra.supertypes ?? [], tags: extra.tags ?? [], subtitle: extra.subtitle ?? null, energy: extra.energy ?? null },
  };
}

// Jinx (Fury/Chaos) mit 16 Füllkarten, damit 40 Karten zusammenkommen
const fillers = Array.from({ length: 16 }, (_, i) => card(`Filler ${String(i).padStart(2, '0')}`, 'Unit', [i % 2 ? 'Fury' : 'Chaos'], { energy: 2, id: `f${i}` }));
const printings: Printing[] = [
  card('Loose Cannon', 'Legend', ['Fury', 'Chaos'], { tags: ['Jinx'], id: 'legend-jinx', no: '247' }),
  card('Loose Cannon', 'Legend', ['Fury', 'Chaos'], { tags: ['Jinx'], id: 'legend-jinx-aa', variant: 'alt_art', no: '247a' }),
  card('Nine-Tailed Fox', 'Legend', ['Calm', 'Mind'], { tags: ['Ahri'], id: 'legend-ahri' }),
  card('Jinx', 'Unit', ['Chaos'], { subtitle: 'Rebel', supertypes: ['Champion'], tags: ['Jinx'], energy: 4, id: 'jinx-rebel' }),
  card('Jinx', 'Unit', ['Fury'], { subtitle: 'Demolitionist', supertypes: ['Champion'], tags: ['Jinx'], energy: 3, id: 'jinx-demo' }),
  card('Super Mega Death Rocket!', 'Spell', ['Fury', 'Chaos'], { supertypes: ['Signature'], tags: ['Jinx'], energy: 4, id: 'rocket' }),
  card('Get Excited!', 'Spell', ['Fury'], { energy: 2, id: 'excited' }),
  card('Chemtech Enforcer', 'Unit', ['Chaos'], { energy: 2, id: 'enforcer' }),
  card('Hextech Ray', 'Spell', ['Fury'], { energy: 1, id: 'ray' }),
  card('Meditation', 'Spell', ['Calm'], { energy: 1, id: 'calm-spell' }),
  card('Fury Rune', 'Rune', ['Fury'], { id: 'fury-rune' }),
  card('Chaos Rune', 'Rune', ['Chaos'], { id: 'chaos-rune' }),
  card('Altar to Unity', 'Battlefield', ['Colorless'], { id: 'bf1' }),
  card('Back-Alley Bar', 'Battlefield', ['Colorless'], { id: 'bf2' }),
  card('Bandle Tree', 'Battlefield', ['Colorless'], { id: 'bf3' }),
  card('Zaun Warrens', 'Battlefield', ['Colorless'], { id: 'bf4' }),
  ...fillers,
];
const pool = deckPool('riftbound', printings, SETS);
const get = (id: string): DeckCard => pool.cards.get(id)!;
const jinx = get('Loose Cannon');
const NOW = Date.parse('2026-11-02T12:00:00Z');

/** Typische Jinx-Liste: 3× Champion, 3× Rakete, 2× Get Excited!, 2× Enforcer, Füller bis 40, 7/5 Runen. */
function jinxList(id: string, extra: Partial<MetaDeck> = {}, cards: Record<string, number> = {}): MetaDeck {
  const base: Record<string, number> = { 'legend-jinx': 1, 'jinx-rebel': 3, rocket: 3, excited: 2, enforcer: 2, 'fury-rune': 7, 'chaos-rune': 5, bf1: 1, bf2: 1, bf3: 1 };
  fillers.slice(0, 10).forEach((f) => (base[f.printingId] = 3));
  return { id, event: 'Convergence IV', place: 1, date: '2026-11-01', cards: { ...base, ...cards }, ...extra };
}

const meta: MetaFile = {
  gameId: 'riftbound',
  source: 'riftbound.gg',
  sourceUrl: 'https://riftbound.gg/decks/',
  builtAt: '2026-11-02T04:00:00Z',
  maxPlace: 8,
  decks: [
    jinxList('a'),
    jinxList('b', { place: 4, event: 'LDXP Sacramento' }),
    // Eine Liste mit Ray statt Enforcer, Alt-Art-Legende
    jinxList('c', { place: 8, date: '2026-10-01' }, { 'legend-jinx': 0, 'legend-jinx-aa': 1, enforcer: 0, ray: 2 }),
    { id: 'ahri', event: 'Convergence IV', place: 2, date: '2026-11-01', cards: { 'legend-ahri': 1, 'calm-spell': 3 } },
  ],
};

describe('Gewicht einer Turnierliste', () => {
  it('zählt neue Listen und bessere Plätze mehr', () => {
    expect(deckWeight({ date: '2026-11-02', place: 1 }, NOW)).toBeCloseTo(1, 1);
    expect(deckWeight({ date: '2026-10-03', place: 1 }, NOW)).toBeCloseTo(0.5, 1);
    expect(deckWeight({ date: '2026-11-02', place: 8 }, NOW)).toBeLessThan(deckWeight({ date: '2026-11-02', place: 2 }, NOW));
  });
});

describe('Meta einer Legende', () => {
  const stats = metaStats(meta, jinx, pool, NOW)!;

  it('sammelt nur die Listen dieser Legende, auch mit anderem Druck der Legende', () => {
    expect(stats.decks).toBe(3);
    expect(stats.events).toBe(2);
    expect(stats.best).toEqual({ place: 1, event: 'Convergence IV', date: '2026-11-01' });
    expect(metaCounts(meta, pool).get('Nine-Tailed Fox')).toBe(1);
    expect(metaStats(meta, get('Nine-Tailed Fox'), pool, NOW)?.decks).toBe(1);
  });

  it('kennt Spielrate und Kopien', () => {
    expect(playRate(stats, 'Super Mega Death Rocket!')).toBeCloseTo(1);
    expect(stats.share.get('Chemtech Enforcer')![0]).toBeGreaterThan(0.7);
    expect(stats.share.get('Chemtech Enforcer')![2]).toBe(0);
    expect(playRate(stats, 'Hextech Ray')).toBeGreaterThan(0);
    expect(playRate(stats, 'Hextech Ray')).toBeLessThan(0.3);
  });

  it('schlägt den meistgespielten Champion vor', () => {
    expect(metaChampion(stats, [get('Jinx, Demolitionist'), get('Jinx, Rebel')])?.id).toBe('Jinx, Rebel');
  });

  it('gibt ohne Listen nichts zurück', () => {
    expect(metaStats(null, jinx, pool)).toBeNull();
    expect(metaStats({ ...meta, decks: [] }, jinx, pool)).toBeNull();
  });
});

describe('Deck aus der Meta bauen', () => {
  const stats = metaStats(meta, jinx, pool, NOW)!;
  const empty = newDeck('riftbound', jinx, get('Jinx, Rebel'), 'd1', '2026-11-02T12:00:00Z');

  it('baut ein vollständiges, regelkonformes Deck aus den meistgespielten Karten', () => {
    const deck = buildFromMeta(empty, stats, pool);
    expect(mainCount(deck)).toBe(40);
    expect(checkDeck(deck, pool).complete).toBe(true);
    expect(copiesOf(deck, 'Jinx, Rebel')).toBe(3);
    expect(deck.cards['Super Mega Death Rocket!']).toBe(3);
    expect(deck.cards['Chemtech Enforcer']).toBe(2);
    expect(deck.runes).toEqual({ 'Fury Rune': 7, 'Chaos Rune': 5 });
    expect(deck.battlefields).toEqual(['Altar to Unity', 'Back-Alley Bar', 'Bandle Tree']);
    expect(deck.legend).toBe('Loose Cannon');
  });

  it('füllt Lücken mit den nächstbesten Karten', () => {
    // Ray (2 Kopien in einer alten Liste) ersetzt keine Stammkarte, kommt aber vor ungespielten Karten
    const deck = buildFromMeta(empty, stats, pool);
    expect(deck.cards['Hextech Ray'] ?? 0).toBeLessThanOrEqual(2);
    expect(deck.cards['Meditation']).toBeUndefined();
  });

  it('bevorzugt auf Wunsch Karten aus der Sammlung, wenn sie fast genauso oft gespielt werden', () => {
    const owned = new Map([['Hextech Ray', 2]]);
    const plain = buildFromMeta(empty, stats, pool, { owned });
    const mine = buildFromMeta(empty, stats, pool, { owned, preferOwned: true });
    expect(mine.cards['Hextech Ray'] ?? 0).toBeGreaterThanOrEqual(plain.cards['Hextech Ray'] ?? 0);
    expect(mainCount(mine)).toBe(40);
  });

  it('nimmt einen anderen Champion als Chosen Champion und zählt ihn bei den Kopien mit', () => {
    const demo = newDeck('riftbound', jinx, get('Jinx, Demolitionist'), 'd2', '2026-11-02T12:00:00Z');
    const deck = buildFromMeta(demo, stats, pool);
    expect(deck.champion).toBe('Jinx, Demolitionist');
    expect(mainCount(deck)).toBe(40);
    expect(copiesOf(deck, 'Jinx, Rebel')).toBe(3);
  });
});

describe('Runen aus der Meta', () => {
  const runes = [get('Fury Rune'), get('Chaos Rune')];
  it('verteilt 12 Runen im Verhältnis der Listen', () => {
    expect(metaRunes({ runes: new Map([['Fury Rune', 8.4], ['Chaos Rune', 3.6]]) }, runes)).toEqual({ 'Fury Rune': 8, 'Chaos Rune': 4 });
    expect(metaRunes({ runes: new Map([['Fury Rune', 6.5], ['Chaos Rune', 5.5]]) }, runes)).toEqual({ 'Fury Rune': 7, 'Chaos Rune': 5 });
  });
  it('verteilt ohne Daten gleichmäßig', () => {
    expect(metaRunes({ runes: new Map() }, runes)).toEqual({ 'Fury Rune': 6, 'Chaos Rune': 6 });
  });
});

describe('Turnierlisten von dotgg', () => {
  const index = dotggIndex(printings);
  it('übersetzt dotgg-Nummern in unsere Drucke und merkt sich unbekannte', () => {
    const unknown = new Set<string>();
    const deck = toMetaDeck(
      {
        slug: 'jim-dudek-convergence-iv',
        date: '1793507685',
        is_tournament: '1',
        boards: [{ 'OGN-247': '1', 'OGN-247a': '1', 'XYZ-001': '2' }, {}],
        tournament: { place: 3, tournament_name: 'Convergence IV' },
      },
      index,
      unknown,
    );
    expect(deck).toEqual({ id: 'jim-dudek-convergence-iv', event: 'Convergence IV', place: 3, date: '2026-11-01', cards: { 'legend-jinx': 1, 'legend-jinx-aa': 1 } });
    expect([...unknown]).toEqual(['XYZ-001']);
  });

  it('lässt leere Listen weg', () => {
    expect(toMetaDeck({ slug: 'x', date: '1793507685', boards: [{}] }, index, new Set())).toBeNull();
  });
});

describe('Schwächere Legenden und Turnierdecks', () => {
  it('zählt Community-Decks weniger und nur, wenn es wenige Turnierlisten gibt', () => {
    expect(deckWeight({ date: '2026-11-02', community: true }, NOW)).toBeCloseTo(0.3, 1);
    const withCommunity: MetaFile = {
      ...meta,
      decks: [...meta.decks, jinxList('c1', { community: true, place: undefined }, { enforcer: 0, ray: 3 })],
    };
    const stats = metaStats(withCommunity, jinx, pool, NOW)!;
    expect(stats.decks).toBe(3);
    expect(stats.community).toBe(1);
    expect(playRate(stats, 'Hextech Ray')).toBeGreaterThan(playRate(metaStats(meta, jinx, pool, NOW)!, 'Hextech Ray'));
    // Community-Decks zählen nicht als Turnierliste
    expect(metaCounts(withCommunity, pool).get('Loose Cannon')).toBe(3);
    expect(stats.lists.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('sortiert Turnierdecks nach Platz, dann die neuesten zuerst', () => {
    const lists = [jinxList('x', { place: 8 }), jinxList('y', { place: 1, date: '2026-10-01' }), jinxList('z', { place: 1, date: '2026-10-20' }), jinxList('n', { place: undefined })];
    expect(lists.sort(byPlacement).map((l) => l.id)).toEqual(['z', 'y', 'x', 'n']);
  });

  it('übernimmt eine einzelne Turnierliste mit Side Deck', () => {
    const empty = newDeck('riftbound', jinx, get('Jinx, Demolitionist'), 'd3', '2026-11-02T12:00:00Z');
    const deck = deckFromList(empty, jinxList('a', {}, {}), jinx, pool);
    // Die Liste spielt Rebel, nicht Demolitionist: Rebel wird Chosen Champion
    expect(deck.champion).toBe('Jinx, Rebel');
    expect(copiesOf(deck, 'Jinx, Rebel')).toBe(3);
    expect(mainCount(deck)).toBe(40);
    expect(deck.runes).toEqual({ 'Fury Rune': 7, 'Chaos Rune': 5 });
    expect(checkDeck(deck, pool).complete).toBe(true);
    const withSide = deckFromList(empty, { ...jinxList('s'), side: { ray: 2 } }, jinx, pool);
    expect(withSide.side).toEqual({ 'Hextech Ray': 2 });
  });

  it('baut ein Side Deck aus den Sideboards', () => {
    const sided: MetaFile = { ...meta, decks: meta.decks.map((d) => (d.id === 'ahri' ? d : { ...d, side: { ray: 2, 'calm-spell': 3 } })) };
    const stats = metaStats(sided, jinx, pool, NOW)!;
    const deck = buildFromMeta(newDeck('riftbound', jinx, get('Jinx, Rebel'), 'd4', '2026-11-02T12:00:00Z'), stats, pool);
    // Meditation (Calm) passt nicht zu Jinx; Ray zählt mit dem Hauptdeck bis 3
    expect(deck.side?.['Meditation']).toBeUndefined();
    expect((deck.side?.['Hextech Ray'] ?? 0) + (deck.cards['Hextech Ray'] ?? 0)).toBeLessThanOrEqual(3);
    expect(deck.side?.['Hextech Ray']).toBeGreaterThan(0);
  });

  it('erkennt die Legende auch ohne Feld „leader“', () => {
    expect(hasLegend({ slug: 'a', date: '1', leader: 'OGN-247' }, 'ogn-247')).toBe(true);
    expect(hasLegend({ slug: 'b', date: '1', leader: '', boards: [{ 'OGN-247': '1' }] }, 'OGN-247')).toBe(true);
    expect(hasLegend({ slug: 'c', date: '1', boards: [{ 'OGN-001': '3' }] }, 'OGN-247')).toBe(false);
  });
});
