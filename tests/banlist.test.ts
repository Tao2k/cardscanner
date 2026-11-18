import { describe, expect, it } from 'vitest';
import { banKey, banLabel, bannedNames, newerBanlist, RIFTBOUND_BANLIST, type BanlistFile } from '../src/core/banlist';
import { championsFor, checkDeck, deckPool, newDeck, room, sideRoom, toggleBattlefield, withCard, withSideCard, type DeckCard } from '../src/core/deck';
import { bannedInList, buildFromMeta, deckFromList, metaBanned, metaStats, type MetaDeck, type MetaFile } from '../src/core/meta';
import { banArticleLinks, isoDate, mergeBanArticles, parseBanArticle } from '../scripts/adapters/riftbound-banlist';
import type { CardSet, Printing } from '../src/core/types';

const SETS: CardSet[] = [{ setId: 'OGN', code: 'OGN', name: 'Origins', releaseDate: '2025-10-31' }];

let n = 0;
function card(name: string, type: string, domains: string[], extra: { subtitle?: string; supertypes?: string[]; tags?: string[]; energy?: number; id?: string } = {}): Printing {
  const id = extra.id ?? `p${++n}`;
  return {
    printingId: id,
    cardName: name,
    setCode: 'OGN',
    collectorNumber: String(++n),
    variant: 'normal',
    type,
    imageUrl: `https://cdn.test/${id}.png`,
    attributes: { domains, supertypes: extra.supertypes ?? [], tags: extra.tags ?? [], subtitle: extra.subtitle ?? null, energy: extra.energy ?? 2 },
  };
}

const fillers = Array.from({ length: 16 }, (_, i) => card(`Filler ${String(i).padStart(2, '0')}`, 'Unit', [i % 2 ? 'Fury' : 'Body'], { id: `f${i}` }));
const printings: Printing[] = [
  card('Exile', 'Legend', ['Fury', 'Body'], { tags: ['Riven'], id: 'legend-riven' }),
  card('Riven', 'Unit', ['Fury'], { subtitle: 'Broken Blade', supertypes: ['Champion'], tags: ['Riven'], id: 'riven-bb' }),
  card('Riven', 'Unit', ['Body'], { subtitle: 'Sharpened', supertypes: ['Champion'], tags: ['Riven'], id: 'riven-sh' }),
  card("Zhonya’s Hourglass", 'Gear', ['Colorless'], { id: 'zhonya' }),
  card('Stellacorn Herder', 'Unit', ['Body'], { id: 'herder' }),
  card('Fury Rune', 'Rune', ['Fury'], { id: 'fury-rune' }),
  card('Body Rune', 'Rune', ['Body'], { id: 'body-rune' }),
  card('Star Spring', 'Battlefield', ['Colorless'], { id: 'spring' }),
  card('Altar to Unity', 'Battlefield', ['Colorless'], { id: 'bf1' }),
  card('Back-Alley Bar', 'Battlefield', ['Colorless'], { id: 'bf2' }),
  card('Bandle Tree', 'Battlefield', ['Colorless'], { id: 'bf3' }),
  ...fillers,
];
const bans = bannedNames(RIFTBOUND_BANLIST);
const pool = deckPool('riftbound', printings, SETS, bans);
const get = (id: string): DeckCard => pool.cards.get(id)!;
const legend = get('Exile');

describe('Banlist', () => {
  it('vergleicht Namen unabhängig von Apostroph, Bindestrich und Schreibung', () => {
    expect(banKey('Draven - Vanquisher')).toBe(banKey('Draven, Vanquisher'));
    expect(banKey('Zhonya’s Hourglass')).toBe(banKey("zhonya's hourglass"));
  });

  it('enthält die Novemberwelle 2026 und trennt Standard von 2v2', () => {
    expect(bans.get(banKey('Riven, Broken Blade'))?.since).toBe('2026-11-23');
    expect(bans.get(banKey('Stacked Deck'))?.since).toBe('2026-09-18');
    expect(bans.has(banKey('Master Yi, Wuju Bladesman'))).toBe(false);
    expect(bannedNames(RIFTBOUND_BANLIST, '2v2').has(banKey('Master Yi, Wuju Bladesman'))).toBe(true);
    expect(RIFTBOUND_BANLIST.entries.filter((e) => e.formats.includes('standard'))).toHaveLength(22);
  });

  it('nennt, ob ein Bann schon gilt oder erst kommt', () => {
    expect(banLabel({ since: '2026-11-23', source: '' }, '2026-11-15')).toBe('Gesperrt ab 23.11.2026');
    expect(banLabel({ since: '2026-09-18', source: '' }, '2026-11-15')).toBe('Gesperrt seit 18.9.2026');
  });

  it('nimmt die neuere von eingebauter und gebauter Liste', () => {
    const built: BanlistFile = { ...RIFTBOUND_BANLIST, updatedAt: '2026-12-01', entries: [] };
    expect(newerBanlist(built, RIFTBOUND_BANLIST)).toBe(built);
    expect(newerBanlist({ ...built, updatedAt: '2026-10-01' }, RIFTBOUND_BANLIST)).toBe(RIFTBOUND_BANLIST);
    expect(newerBanlist(null, RIFTBOUND_BANLIST)).toBe(RIFTBOUND_BANLIST);
  });
});

describe('Deckbau mit Banlist', () => {
  const deck = newDeck('riftbound', legend, get('Riven, Sharpened'), 'd1', '2026-11-15T12:00:00Z');

  it('markiert gesperrte Karten, Drucke mit anderem Apostroph inklusive', () => {
    expect(get('Riven, Broken Blade').banned?.since).toBe('2026-11-23');
    expect(get("Zhonya’s Hourglass").banned).toBeTruthy();
    expect(get('Star Spring').banned).toBeTruthy();
    expect(get('Riven, Sharpened').banned).toBeUndefined();
  });

  it('lässt gesperrte Karten weder ins Hauptdeck noch ins Side Deck noch als Battlefield', () => {
    const herder = get('Stellacorn Herder');
    expect(room(deck, herder, pool)).toBe(0);
    expect(sideRoom(deck, herder)).toBe(0);
    expect(withCard(deck, herder, 1, pool)).toBe(deck);
    expect(withSideCard(deck, herder, 1)).toBe(deck);
    expect(toggleBattlefield(deck, get('Star Spring'))).toBe(deck);
    expect(toggleBattlefield(deck, get('Altar to Unity')).battlefields).toEqual(['Altar to Unity']);
  });

  it('bietet gesperrte Champions nicht als Chosen Champion an', () => {
    expect(championsFor(legend, pool).map((c) => c.id)).toEqual(['Riven, Sharpened']);
  });

  it('meldet gesperrte Karten in gespeicherten Decks zuerst', () => {
    const old = { ...deck, champion: 'Riven, Broken Blade', cards: { 'Stellacorn Herder': 2 }, side: { "Zhonya’s Hourglass": 1 }, battlefields: ['Star Spring'] };
    const check = checkDeck(old, pool);
    expect(check.complete).toBe(false);
    expect(check.problems.slice(0, 4)).toEqual([
      'Riven, Broken Blade ist gesperrt',
      'Stellacorn Herder ist gesperrt',
      "Zhonya’s Hourglass ist gesperrt",
      'Star Spring ist gesperrt',
    ]);
  });

  it('ohne Banlist bleibt alles erlaubt', () => {
    const free = deckPool('riftbound', printings, SETS);
    expect(free.cards.get('Stellacorn Herder')!.banned).toBeUndefined();
  });
});

describe('Meta mit Banlist', () => {
  const list = (id: string, place: number): MetaDeck => {
    const cards: Record<string, number> = { 'legend-riven': 1, 'riven-bb': 3, 'riven-sh': 1, herder: 3, zhonya: 2, 'fury-rune': 6, 'body-rune': 6, spring: 1, bf1: 1, bf2: 1 };
    fillers.slice(0, 11).forEach((f) => (cards[f.printingId] = 3));
    return { id, event: 'Convergence IV', place, date: '2026-11-08', cards, side: { herder: 1, f12: 2 } };
  };
  const meta: MetaFile = { gameId: 'riftbound', source: 'riftbound.gg', sourceUrl: '', builtAt: '2026-11-09T04:00:00Z', maxPlace: 8, decks: [list('a', 1), list('b', 2)] };
  const stats = metaStats(meta, legend, pool, Date.parse('2026-11-15T12:00:00Z'))!;
  const empty = newDeck('riftbound', legend, get('Riven, Sharpened'), 'd2', '2026-11-15T12:00:00Z');

  it('schlägt keine gesperrten Karten vor und nennt sie', () => {
    const built = buildFromMeta(empty, stats, pool);
    expect(built.cards['Stellacorn Herder']).toBeUndefined();
    expect(built.cards["Zhonya’s Hourglass"]).toBeUndefined();
    expect(built.cards['Riven, Broken Blade']).toBeUndefined();
    expect(built.side?.['Stellacorn Herder']).toBeUndefined();
    expect(built.battlefields).not.toContain('Star Spring');
    expect(built.battlefields).toHaveLength(3);
    expect(checkDeck(built, pool).problems.filter((p) => p.endsWith('gesperrt'))).toEqual([]);
    expect(metaBanned(stats, pool).map((c) => c.id).sort()).toEqual(['Riven, Broken Blade', 'Star Spring', 'Stellacorn Herder', "Zhonya’s Hourglass"]);
  });

  it('kennzeichnet Turnierlisten mit gesperrten Karten und übernimmt sie ohne diese', () => {
    expect(bannedInList(meta.decks[0], pool).map((c) => c.id).sort()).toEqual(['Riven, Broken Blade', 'Star Spring', 'Stellacorn Herder', "Zhonya’s Hourglass"]);
    const taken = deckFromList(empty, meta.decks[0], legend, pool);
    expect(taken.champion).toBe('Riven, Sharpened');
    expect(Object.keys(taken.cards).some((id) => get(id)?.banned)).toBe(false);
    expect(taken.side?.['Stellacorn Herder']).toBeUndefined();
    expect(taken.battlefields).toEqual(['Altar to Unity', 'Back-Alley Bar']);
  });
});

/** Nachbau von Riots Bann-Artikel (November 2026), gekürzt. */
const ARTICLE = `<!doctype html><html><head><title>Radiance Ban List Updates (Effective November 23, 2026) | Riftbound</title>
<script>var x = "<li>Not a card</li>";</script></head><body><article>
<h1>Radiance Ban List Updates (Effective November 23, 2026)</h1>
<p><strong>Effective</strong>: November 23, 2026</p>
<p>Eight cards and two battlefields are being added to the Standard and 2v2 Constructed ban list:</p>
<h4>Cards</h4><ul><li><p>Riven, Broken Blade</p></li><li>Zhonya&#x27;s Hourglass</li><li>Stellacorn Herder</li></ul>
<h4>Battlefields</h4><ul><li>Star Spring</li></ul>
<hr/>
<p>Hi everyone, Dave Guskin here. We want to talk about why these cards are banned, with a long paragraph of reasoning.</p>
<ul><li>Some bullet in the reasoning that is not a card</li></ul>
<h2>Region Specific Bans</h2>
<p>In Korea, the following cards are removed from the ban list until Radiance releases:</p>
<ul><li>Riven, Broken Blade</li></ul>
</article></body></html>`;

describe('Riots Bann-Artikel lesen', () => {
  it('findet Bann-Artikel in der Nachrichtenübersicht', () => {
    const html = `<a href="/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026/">x</a>
      <a href="https://playriftbound.com/en-us/news/announcements/radiance-errata-updates/">y</a>
      <a href="/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026">dup</a>`;
    expect(banArticleLinks(html)).toEqual(['https://playriftbound.com/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026/']);
  });

  it('liest Karten, Formate und Datum, aber keine regionalen Ausnahmen', () => {
    const a = parseBanArticle(ARTICLE, 'https://playriftbound.com/en-us/news/announcements/x/');
    expect(a.effective).toBe('2026-11-23');
    expect(a.formats).toEqual(['standard', '2v2']);
    expect(a.added).toEqual(['Riven, Broken Blade', "Zhonya's Hourglass", 'Stellacorn Herder', 'Star Spring']);
    expect(a.removed).toEqual([]);
    expect(isoDate('March 31, 2026')).toBe('2026-03-31');
  });

  it('übernimmt nur neue Artikel und nur Namen aus dem Katalog', () => {
    const known = new Set([...pool.cards.values()].map((c) => banKey(c.id)));
    const base: BanlistFile = { ...RIFTBOUND_BANLIST, entries: RIFTBOUND_BANLIST.entries.filter((e) => e.since < '2026-11-01') };
    const article = { ...parseBanArticle(ARTICLE, 'https://playriftbound.com/en-us/news/announcements/new-ban-list/'), added: ['Stellacorn Herder', 'Unknown Card'] };
    const { file, articles, unknown } = mergeBanArticles(base, [article], known, '2026-11-20');
    expect(articles).toHaveLength(1);
    expect(unknown).toEqual(['Unknown Card']);
    expect(file.entries.at(-1)).toEqual({ name: 'Stellacorn Herder', since: '2026-11-23', formats: ['standard', '2v2'], source: article.url });
    expect(file.updatedAt).toBe('2026-11-20');
    expect(file.sourceUrl).toBe(article.url);

    // Schon eingearbeitet: nichts ändert sich
    const again = mergeBanArticles(RIFTBOUND_BANLIST, [{ ...article, url: RIFTBOUND_BANLIST.sourceUrl }], known, '2026-11-20');
    expect(again.articles).toHaveLength(0);
    expect(again.file.entries).toEqual(RIFTBOUND_BANLIST.entries);
  });

  it('streicht Karten, die Riot wieder freigibt', () => {
    const known = new Set([banKey('Stacked Deck')]);
    const html = `<title>Ban List Update (Effective January 9, 2027)</title><p>The following card is being removed from the Standard and 2v2 ban list:</p><ul><li>Stacked Deck</li></ul><hr>`;
    const a = parseBanArticle(html, 'https://playriftbound.com/en-us/news/announcements/unban-list/');
    expect(a.removed).toEqual(['Stacked Deck']);
    const { file } = mergeBanArticles(RIFTBOUND_BANLIST, [a], known, '2027-01-05');
    expect(file.entries.some((e) => e.name === 'Stacked Deck')).toBe(false);
  });
});
