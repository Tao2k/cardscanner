import { describe, expect, it } from 'vitest';
import {
  championsFor,
  checkDeck,
  deckPool,
  deckValue,
  evenRunes,
  mainCardsFor,
  missingCount,
  newDeck,
  ownedByCard,
  room,
  runesFor,
  toggleBattlefield,
  withCard,
  withChampion,
  withRune,
  type Deck,
} from '../src/core/deck';
import type { CardSet, CollectionItem, Printing } from '../src/core/types';

const SETS: CardSet[] = [
  { setId: 'OGN', code: 'OGN', name: 'Origins', releaseDate: '2025-10-31' },
  { setId: 'SFD', code: 'SFD', name: 'Spiritforged', releaseDate: '2026-02-13' },
  { setId: 'OGNX', code: 'OGNX', name: 'Origins Promos', promo: true },
];

let n = 0;
/** Druck wie aus der Kartengalerie (scripts/adapters/riftbound.ts). */
function card(name: string, type: string, domains: string[], extra: { subtitle?: string; supertypes?: string[]; tags?: string[]; energy?: number; set?: string; variant?: Printing['variant']; id?: string } = {}): Printing {
  const id = extra.id ?? `p${++n}`;
  return {
    printingId: id,
    cardName: name,
    setCode: extra.set ?? 'OGN',
    collectorNumber: String(n),
    variant: extra.variant ?? 'normal',
    type,
    imageUrl: `https://cdn.test/${id}.png`,
    attributes: {
      domains,
      supertypes: extra.supertypes ?? [],
      tags: extra.tags ?? [],
      subtitle: extra.subtitle ?? null,
      energy: extra.energy ?? null,
    },
  };
}

const printings: Printing[] = [
  card('Loose Cannon', 'Legend', ['Fury', 'Chaos'], { tags: ['Jinx'], id: 'legend-jinx' }),
  card('Loose Cannon', 'Legend', ['Fury', 'Chaos'], { tags: ['Jinx'], variant: 'overnumbered', id: 'legend-jinx-showcase' }),
  card('Nine-Tailed Fox', 'Legend', ['Calm', 'Mind'], { tags: ['Ahri'] }),
  card('Fire Below the Mountain', 'Legend', ['Calm', 'Mind'], { tags: ['Ornn'] }),
  card('Jinx', 'Unit', ['Chaos'], { subtitle: 'Rebel', supertypes: ['Champion'], tags: ['Jinx', 'Zaun'], energy: 4, id: 'jinx-rebel' }),
  card('Jinx', 'Unit', ['Fury'], { subtitle: 'Demolitionist', supertypes: ['Champion'], tags: ['Jinx'], energy: 3, id: 'jinx-demo', set: 'SFD' }),
  card('Jinx', 'Unit', ['Fury'], { subtitle: 'Demolitionist', supertypes: ['Champion'], tags: ['Jinx'], energy: 3, id: 'jinx-demo-promo', set: 'OGNX', variant: 'promo' }),
  card('Ahri', 'Unit', ['Mind'], { subtitle: 'Alluring', supertypes: ['Champion'], tags: ['Ahri', 'Ionia'], energy: 3 }),
  // Fehler in den Galeriedaten: Karma trägt das Schlagwort Vi, ist aber kein Vi-Champion
  card('Karma', 'Unit', ['Order'], { subtitle: 'Channeler', supertypes: ['Champion'], tags: ['Vi', 'Ionia'] }),
  card('Super Mega Death Rocket!', 'Spell', ['Fury', 'Chaos'], { supertypes: ['Signature'], tags: ['Jinx'], energy: 4, id: 'rocket' }),
  card('Fox-Fire', 'Spell', ['Calm', 'Mind'], { supertypes: ['Signature'], tags: ['Ahri'] }),
  card('Forgefire Cape', 'Gear', ['Calm', 'Mind'], { supertypes: ['Signature'], tags: ['Ornn', 'Equipment'] }),
  card('Rabadon\'s Deathcrown', 'Gear', ['Calm', 'Mind'], { supertypes: ['Signature'], tags: ['Ornn', 'Equipment'] }),
  card('Ornn', 'Unit', ['Calm'], { subtitle: 'Blacksmith', supertypes: ['Champion'], tags: ['Ornn'] }),
  card('Get Excited!', 'Spell', ['Fury'], { energy: 2, id: 'excited' }),
  card('Chemtech Enforcer', 'Unit', ['Chaos'], { energy: 2, id: 'enforcer' }),
  card('Hextech Ray', 'Spell', ['Fury'], { energy: 1, id: 'ray' }),
  card('Neeko', 'Unit', ['Colorless'], { subtitle: 'Curious', supertypes: ['Champion'], tags: ['Neeko'], id: 'neeko' }),
  card('Meditation', 'Spell', ['Calm'], { energy: 1, id: 'calm-spell' }),
  card('Sprite', 'Unit', ['Colorless'], { supertypes: ['Token'] }),
  card('Fury Rune', 'Rune', ['Fury'], { supertypes: ['Basic'], id: 'fury-rune' }),
  card('Fury Rune', 'Rune', ['Fury'], { supertypes: ['Basic'], variant: 'alt_art', id: 'fury-rune-aa' }),
  card('Chaos Rune', 'Rune', ['Chaos'], { supertypes: ['Basic'], id: 'chaos-rune' }),
  card('Calm Rune', 'Rune', ['Calm'], { supertypes: ['Basic'] }),
  card('Altar to Unity', 'Battlefield', ['Colorless'], { id: 'bf1' }),
  card('Back-Alley Bar', 'Battlefield', ['Colorless'], { id: 'bf2' }),
  card('Bandle Tree', 'Battlefield', ['Colorless'], { id: 'bf3' }),
  card('Zaun Warrens', 'Battlefield', ['Colorless'], { id: 'bf4' }),
  // RAD-Karten ohne Typ in der Galerie
  card('Hush', '', []),
];

const pool = deckPool('riftbound', printings, SETS);
const get = (id: string) => pool.cards.get(id)!;
const jinx = get('Loose Cannon');

function jinxDeck(): Deck {
  return newDeck('riftbound', jinx, get('Jinx, Rebel'), 'd1', '2026-10-30T12:00:00.000Z');
}

describe('Kartenpool für den Deckbau', () => {
  it('fasst Drucke einer Karte zusammen und nimmt den normalen Druck aus dem ältesten Set', () => {
    expect(jinx.printing.printingId).toBe('legend-jinx');
    expect(pool.cardOf('legend-jinx-showcase')?.id).toBe('Loose Cannon');
    expect(get('Fury Rune').printing.printingId).toBe('fury-rune');
    // Promo derselben Karte zählt zur Karte, wird aber nicht gezeigt
    expect(pool.cardOf('jinx-demo-promo')?.id).toBe('Jinx, Demolitionist');
    expect(get('Jinx, Demolitionist').printing.printingId).toBe('jinx-demo');
  });

  it('unterscheidet Champions am Titel und lässt Spielmarken und Karten ohne Typ weg', () => {
    expect(pool.cards.has('Jinx, Rebel')).toBe(true);
    expect(pool.cards.has('Jinx, Demolitionist')).toBe(true);
    expect(pool.cards.has('Sprite')).toBe(false);
    expect(pool.cards.has('Hush')).toBe(false);
  });

  it('erkennt den Champion einer Legende am Schlagwort', () => {
    expect(pool.legends.map((l) => l.championOf)).toEqual(['Ahri', 'Jinx', 'Ornn']);
  });

  it('bietet nur Champions der Legende an, keine Signature-Einheit und keinen falsch verschlagworteten', () => {
    expect(championsFor(jinx, pool).map((c) => c.id)).toEqual(['Jinx, Demolitionist', 'Jinx, Rebel']);
    const vi = deckPool('riftbound', [card('Piltover Enforcer', 'Legend', ['Fury', 'Order'], { tags: ['Vi'] }), card('Vi', 'Unit', ['Fury'], { subtitle: 'Destructive', supertypes: ['Champion'], tags: ['Vi'] }), printings[8]], SETS);
    const viLegend = vi.legends[0];
    expect(viLegend.championOf).toBe('Vi');
    expect(championsFor(viLegend, vi).map((c) => c.id)).toEqual(['Vi, Destructive']);
  });

  it('lässt nur Karten aus den Domains der Legende und nur ihre Signature-Karte zu', () => {
    const ids = mainCardsFor(jinx, pool).map((c) => c.id);
    expect(ids).toContain('Get Excited!');
    expect(ids).toContain('Chemtech Enforcer');
    expect(ids).toContain('Super Mega Death Rocket!');
    expect(ids).toContain('Neeko, Curious'); // farblos passt überall
    expect(ids).not.toContain('Meditation');
    expect(ids).not.toContain('Fox-Fire');
    expect(ids).not.toContain('Ahri, Alluring');
    expect(ids).not.toContain('Fury Rune');
    expect(ids).not.toContain('Altar to Unity');
    expect(ids).not.toContain('Loose Cannon');
    const ornn = mainCardsFor(get('Fire Below the Mountain'), pool).filter((c) => c.signature).map((c) => c.id);
    expect(ornn).toEqual(['Forgefire Cape', "Rabadon's Deathcrown"]);
  });

  it('bietet die Runen der beiden Domains an', () => {
    expect(runesFor(jinx, pool).map((r) => r.id)).toEqual(['Fury Rune', 'Chaos Rune']);
  });
});

describe('Deck zusammenstellen', () => {
  it('startet mit Legende und Champion, Name nach dem Champion', () => {
    const deck = jinxDeck();
    expect(deck.name).toBe('Jinx');
    const check = checkDeck(deck, pool);
    expect(check.main).toBe(1);
    expect(check.complete).toBe(false);
    expect(check.problems).toEqual(['Noch 39 Karten', 'Noch 12 Runen', 'Noch 3 Battlefields']);
  });

  it('erlaubt höchstens 3 Karten mit gleichem Namen, der Chosen Champion zählt mit', () => {
    let deck = jinxDeck();
    const rebel = get('Jinx, Rebel');
    for (let i = 0; i < 5; i++) deck = withCard(deck, rebel, 1, pool);
    expect(deck.cards['Jinx, Rebel']).toBe(2);
    expect(room(deck, rebel, pool)).toBe(0);
    const ray = get('Hextech Ray');
    for (let i = 0; i < 5; i++) deck = withCard(deck, ray, 1, pool);
    expect(deck.cards['Hextech Ray']).toBe(3);
    deck = withCard(deck, ray, -1, pool);
    expect(deck.cards['Hextech Ray']).toBe(2);
    deck = withCard(withCard(deck, ray, -1, pool), ray, -1, pool);
    expect(deck.cards['Hextech Ray']).toBeUndefined();
    expect(withCard(deck, ray, -1, pool)).toBe(deck);
  });

  it('erlaubt höchstens 3 Signature-Karten insgesamt', () => {
    let deck = newDeck('riftbound', get('Fire Below the Mountain'), get('Ornn, Blacksmith'), 'd2', '2026-10-30T12:00:00.000Z');
    const cape = get('Forgefire Cape');
    const crown = get("Rabadon's Deathcrown");
    deck = withCard(withCard(deck, cape, 1, pool), cape, 1, pool);
    deck = withCard(withCard(deck, crown, 1, pool), crown, 1, pool);
    expect(deck.cards).toEqual({ 'Forgefire Cape': 2, "Rabadon's Deathcrown": 1 });
    expect(room(deck, crown, pool)).toBe(0);
    expect(checkDeck(deck, pool).signatures).toBe(3);
  });

  it('meldet Karten, die nicht zur Legende passen', () => {
    const deck = { ...jinxDeck(), cards: { Meditation: 1, 'Fox-Fire': 1 } };
    const problems = checkDeck(deck, pool).problems;
    expect(problems).toContain('Meditation passt nicht zur Legende');
    expect(problems).toContain('Fox-Fire passt nicht zur Legende');
  });

  it('verteilt 12 Runen und verschiebt die Aufteilung, wenn schon 12 da sind', () => {
    const runes = runesFor(jinx, pool);
    let deck = evenRunes(jinxDeck(), runes);
    expect(deck.runes).toEqual({ 'Fury Rune': 6, 'Chaos Rune': 6 });
    deck = withRune(deck, runes[0], 1, runes);
    expect(deck.runes).toEqual({ 'Fury Rune': 7, 'Chaos Rune': 5 });
    deck = withRune(deck, runes[1], -1, runes);
    expect(checkDeck(deck, pool).problems).toContain('Noch 1 Rune');
    deck = withRune(deck, runes[1], 1, runes);
    deck = withRune(deck, runes[1], 1, runes);
    expect(deck.runes).toEqual({ 'Fury Rune': 6, 'Chaos Rune': 6 });
  });

  it('nimmt höchstens 3 verschiedene Battlefields', () => {
    let deck = jinxDeck();
    for (const id of ['bf1', 'bf2', 'bf3', 'bf4']) deck = toggleBattlefield(deck, pool.cardOf(id)!);
    expect(deck.battlefields).toEqual(['Altar to Unity', 'Back-Alley Bar', 'Bandle Tree']);
    deck = toggleBattlefield(deck, get('Back-Alley Bar'));
    expect(deck.battlefields).toEqual(['Altar to Unity', 'Bandle Tree']);
  });

  it('ist vollständig mit 40 Karten, 12 Runen und 3 Battlefields', () => {
    const extra: Printing[] = [];
    for (let i = 0; i < 13; i++) extra.push(card(`Filler ${i}`, 'Unit', ['Fury'], { energy: 2 }));
    const big = deckPool('riftbound', [...printings, ...extra], SETS);
    let deck = jinxDeck();
    for (const c of mainCardsFor(big.cards.get('Loose Cannon')!, big)) {
      while (checkDeck(deck, big).main < 40 && room(deck, c, big) > 0) deck = withCard(deck, c, 1, big);
    }
    deck = evenRunes(deck, runesFor(jinx, big));
    for (const id of ['bf1', 'bf2', 'bf3']) deck = toggleBattlefield(deck, big.cardOf(id)!);
    const check = checkDeck(deck, big);
    expect(check.main).toBe(40);
    expect(check.problems).toEqual([]);
    expect(check.complete).toBe(true);
  });

  it('tauscht den Champion und hält die Grenze von 3', () => {
    let deck = jinxDeck();
    const demo = get('Jinx, Demolitionist');
    deck = withCard(withCard(withCard(deck, demo, 1, pool), demo, 1, pool), demo, 1, pool);
    expect(deck.cards['Jinx, Demolitionist']).toBe(3);
    deck = withChampion(deck, demo);
    expect(deck.champion).toBe('Jinx, Demolitionist');
    expect(deck.cards['Jinx, Demolitionist']).toBe(2);
    expect(checkDeck(deck, pool).main).toBe(3);
  });
});

describe('Deck und Sammlung', () => {
  const item = (printingId: string, quantity: number): CollectionItem => ({
    itemId: `i-${printingId}`,
    gameId: 'riftbound',
    printingId,
    language: 'en',
    quantity,
    condition: 'NM',
    finish: 'normal',
    location: '',
    notes: '',
    confirmed: true,
    addedAt: '',
    updatedAt: '',
  });

  it('zählt alle Drucke einer Karte als Besitz und rechnet aus, was fehlt', () => {
    const owned = ownedByCard([item('legend-jinx-showcase', 1), item('jinx-rebel', 1), item('ray', 2), item('fury-rune-aa', 4)], pool);
    expect(owned.get('Loose Cannon')).toBe(1);
    let deck = withCard(withCard(withCard(jinxDeck(), get('Hextech Ray'), 1, pool), get('Hextech Ray'), 1, pool), get('Hextech Ray'), 1, pool);
    deck = evenRunes(deck, runesFor(jinx, pool));
    // Hextech Ray 1, Fury Rune 2, Chaos Rune 6
    expect(missingCount(deck, owned)).toBe(9);
  });

  it('rechnet den Wert mit dem Preis je Karte', () => {
    const deck = withCard(jinxDeck(), get('Hextech Ray'), 1, pool);
    const prices: Record<string, number> = { 'Loose Cannon': 3, 'Jinx, Rebel': 10, 'Hextech Ray': 0.5 };
    expect(deckValue(deck, pool, (c) => prices[c.id])).toBe(13.5);
    expect(deckValue({ ...deck, cards: {} }, pool, () => undefined)).toBeUndefined();
  });
});
