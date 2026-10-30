import type { IDBPDatabase } from 'idb';
import type { Deck } from '../core/deck';
import { DB_NAME, DECKS, openAppDb } from './db';

/**
 * Ein Deck im Browser. `dirty` = Änderung noch nicht auf dem Server; ein gelöschtes Deck bleibt als
 * `deleted` stehen, bis der Server es weiß. `changedAt` entscheidet auf dem Server, welche Änderung gewinnt.
 */
export interface StoredDeck {
  deckId: string;
  deck?: Deck;
  deleted: boolean;
  dirty: boolean;
  changedAt: string;
}

/** Decks im Browser; jede Änderung wartet als `dirty` auf den Abgleich (core/deckSync.ts). */
export class DeckStore {
  private db: Promise<IDBPDatabase>;

  constructor(
    dbName = DB_NAME,
    private readonly now: () => Date = () => new Date(),
    /** Wird nach jeder Änderung aufgerufen, damit der Abgleich bald startet. */
    public onChange: () => void = () => {},
  ) {
    this.db = openAppDb(dbName);
  }

  /** Alle Decks, zuletzt geänderte zuerst. */
  async list(): Promise<Deck[]> {
    const rows: StoredDeck[] = await (await this.db).getAll(DECKS);
    return rows
      .filter((r) => !r.deleted && r.deck)
      .map((r) => r.deck!)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(deckId: string): Promise<StoredDeck | undefined> {
    return (await this.db).get(DECKS, deckId);
  }

  async save(deck: Deck): Promise<void> {
    const changedAt = this.now().toISOString();
    await (await this.db).put(DECKS, { deckId: deck.deckId, deck: { ...deck, updatedAt: changedAt }, deleted: false, dirty: true, changedAt } satisfies StoredDeck);
    this.onChange();
  }

  async remove(deckId: string): Promise<void> {
    await (await this.db).put(DECKS, { deckId, deleted: true, dirty: true, changedAt: this.now().toISOString() } satisfies StoredDeck);
    this.onChange();
  }

  /** Noch nicht gesendete Änderungen. */
  async pending(): Promise<StoredDeck[]> {
    const rows: StoredDeck[] = await (await this.db).getAll(DECKS);
    return rows.filter((r) => r.dirty);
  }

  /** Gesendet: als erledigt markieren, außer das Deck wurde inzwischen erneut geändert; gelöschte verschwinden. */
  async done(sent: StoredDeck[]): Promise<void> {
    const tx = (await this.db).transaction(DECKS, 'readwrite');
    for (const change of sent) {
      const current: StoredDeck | undefined = await tx.store.get(change.deckId);
      if (!current || current.changedAt !== change.changedAt) continue;
      if (current.deleted) await tx.store.delete(change.deckId);
      else await tx.store.put({ ...current, dirty: false });
    }
    await tx.done;
  }

  /** Stand vom Server übernehmen (nur für Decks ohne eigene, noch nicht gesendete Änderung). */
  async apply(deckId: string, deck: Deck | undefined, changedAt: string): Promise<void> {
    const db = await this.db;
    if (deck) await db.put(DECKS, { deckId, deck, deleted: false, dirty: false, changedAt } satisfies StoredDeck);
    else await db.delete(DECKS, deckId);
  }

  /** Alle Decks als neu markieren, z. B. vor dem ersten Abgleich eines Kontos. */
  async markAllDirty(): Promise<void> {
    const tx = (await this.db).transaction(DECKS, 'readwrite');
    for (let c = await tx.store.openCursor(); c; c = await c.continue()) if (!c.value.dirty) await c.update({ ...c.value, dirty: true });
    await tx.done;
  }

  async clear(): Promise<void> {
    await (await this.db).clear(DECKS);
  }
}
