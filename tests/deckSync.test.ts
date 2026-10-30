import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Deck } from '../src/core/deck';
import { DeckSync, type RemoteDeckRow, type RemoteDecks } from '../src/core/deckSync';
import { DeckStore, type StoredDeck } from '../src/storage/decks';
import { Outbox } from '../src/storage/outbox';

/** Server im Speicher, verhält sich wie die Tabelle in supabase/migrations/0003_decks.sql (neueste Änderung gewinnt). */
class FakeRemote implements RemoteDecks {
  rows = new Map<string, RemoteDeckRow>();
  private clock = 0;

  async push(changes: StoredDeck[]) {
    for (const c of changes) {
      const old = this.rows.get(c.deckId);
      if (old && c.changedAt < old.changedAt) continue;
      const serverUpdatedAt = new Date(Date.UTC(2026, 9, 30, 12, 0, 0, ++this.clock * 60_000)).toISOString();
      this.rows.set(c.deckId, { deckId: c.deckId, deck: c.deleted ? undefined : c.deck, deleted: c.deleted, changedAt: c.changedAt, serverUpdatedAt });
    }
  }

  async pull(since: string | null) {
    return [...this.rows.values()].filter((r) => !since || r.serverUpdatedAt >= since).sort((a, b) => a.serverUpdatedAt.localeCompare(b.serverUpdatedAt));
  }
}

let dbCounter = 0;
let tick = 0;
/** Ein Gerät mit eigener Datenbank; die Uhr läuft bei jeder Änderung eine Sekunde weiter. */
function device(remote: RemoteDecks, user = 'u1') {
  const name = `decks-${dbCounter++}`;
  const store = new DeckStore(name, () => new Date(Date.UTC(2026, 9, 30, 10, 0, ++tick)));
  return { store, sync: new DeckSync(store, remote, user, new Outbox(name)) };
}

const deck = (deckId: string, name = 'Jinx'): Deck => ({
  deckId,
  gameId: 'riftbound',
  name,
  legend: 'Loose Cannon',
  champion: 'Jinx, Rebel',
  cards: { 'Hextech Ray': 3 },
  runes: { 'Fury Rune': 6, 'Chaos Rune': 6 },
  battlefields: [],
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
});

describe('Decks mit dem Server abgleichen', () => {
  it('bringt ein Deck auf ein anderes Gerät', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.sync.prepare();
    await b.sync.prepare();
    await a.store.save(deck('d1'));
    expect(await a.store.pending()).toHaveLength(1);
    await a.sync.sync();
    expect(await a.store.pending()).toHaveLength(0);
    expect(await b.sync.sync()).toBe(true);
    expect((await b.store.list()).map((d) => d.name)).toEqual(['Jinx']);
    // Nichts Neues: kein erneutes Neuladen
    expect(await b.sync.sync()).toBe(false);
  });

  it('übernimmt Änderungen und Löschen vom anderen Gerät', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.store.save(deck('d1'));
    await a.sync.sync();
    await b.sync.sync();
    await b.store.save(deck('d1', 'Jinx Aggro'));
    await b.sync.sync();
    await a.sync.sync();
    expect((await a.store.list())[0].name).toBe('Jinx Aggro');
    await a.store.remove('d1');
    expect(await a.store.list()).toEqual([]);
    await a.sync.sync();
    expect(await a.store.get('d1')).toBeUndefined();
    await b.sync.sync();
    expect(await b.store.list()).toEqual([]);
  });

  it('überschreibt keine eigene, noch nicht gesendete Änderung', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    await a.store.save(deck('d1', 'alt'));
    await a.sync.sync();
    await b.sync.sync();
    await b.store.save(deck('d1', 'neu auf B'));
    await a.store.save(deck('d1', 'neuer auf A'));
    await b.sync.sync();
    await a.sync.sync();
    await b.sync.sync();
    expect((await a.store.list())[0].name).toBe('neuer auf A');
    expect((await b.store.list())[0].name).toBe('neuer auf A');
  });

  it('lädt Decks von vor der Anmeldung hoch und leert das Gerät bei einem anderen Konto', async () => {
    const remote = new FakeRemote();
    const name = `decks-${dbCounter++}`;
    const store = new DeckStore(name);
    const outbox = new Outbox(name);
    await store.save(deck('d1'));
    await store.done(await store.pending());
    expect(await store.pending()).toHaveLength(0);
    const first = new DeckSync(store, remote, 'u1', outbox);
    await first.prepare();
    expect(await store.pending()).toHaveLength(1);
    await first.sync();
    expect(remote.rows.size).toBe(1);
    const other = new DeckSync(store, remote, 'u2', outbox);
    await other.prepare();
    expect(await store.list()).toEqual([]);
  });
});
