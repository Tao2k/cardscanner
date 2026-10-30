import type { DeckStore, StoredDeck } from '../storage/decks';
import type { Deck } from './deck';

/** Ein Deck, wie es auf dem Server liegt. */
export interface RemoteDeckRow {
  deckId: string;
  /** Fehlt bei gelöschten Decks. */
  deck?: Deck;
  deleted: boolean;
  changedAt: string;
  serverUpdatedAt: string;
}

/** Die Decks einer angemeldeten Person auf dem Server. */
export interface RemoteDecks {
  /** Schickt lokale Änderungen; der Server behält je Deck die neueste (changedAt). */
  push(changes: StoredDeck[]): Promise<void>;
  /** Alle Decks, die der Server seit `since` geschrieben hat; null = alle. */
  pull(since: string | null): Promise<RemoteDeckRow[]>;
}

/** Kleiner Merkzettel im Gerät (Outbox.getMeta/setMeta). */
export interface MetaStore {
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

/** Wie beim Abgleich der Sammlung: Zeilen kurz vor dem letzten Stand werden noch einmal geholt. */
const OVERLAP_MS = 10_000;
const OWNER_KEY = 'deckOwner';

/**
 * Abgleich der Decks mit dem Server, nach demselben Muster wie die Sammlung (core/sync.ts):
 * erst eigene Änderungen senden, dann alles holen, was sich auf dem Server seitdem geändert hat.
 */
export class DeckSync {
  constructor(
    private readonly store: DeckStore,
    private readonly remote: RemoteDecks,
    private readonly userId: string,
    private readonly meta: MetaStore,
  ) {}

  private get cursorKey() {
    return `deckCursor:${this.userId}`;
  }

  /** Decks eines anderen Kontos verschwinden vom Gerät; Decks von vor der Anmeldung werden hochgeladen. */
  async prepare(): Promise<void> {
    const owner = await this.meta.getMeta<string>(OWNER_KEY);
    if (owner && owner !== this.userId) await this.clearLocal();
    else if (!owner) await this.store.markAllDirty();
    await this.meta.setMeta(OWNER_KEY, this.userId);
  }

  async clearLocal(): Promise<void> {
    const owner = await this.meta.getMeta<string>(OWNER_KEY);
    await this.store.clear();
    if (owner) await this.meta.setMeta(`deckCursor:${owner}`, undefined);
    await this.meta.setMeta(OWNER_KEY, undefined);
  }

  /** true, wenn sich Decks auf dem Gerät durch den Server geändert haben. */
  async sync(): Promise<boolean> {
    const pending = await this.store.pending();
    if (pending.length) {
      await this.remote.push(pending);
      await this.store.done(pending);
    }
    const cursor = await this.meta.getMeta<string>(this.cursorKey);
    const rows = await this.remote.pull(cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null);
    let latest = cursor;
    let changed = false;
    for (const row of rows) {
      if (!latest || row.serverUpdatedAt > latest) latest = row.serverUpdatedAt;
      const local = await this.store.get(row.deckId);
      if (local?.dirty) continue;
      if (row.deleted || !row.deck) {
        if (local) {
          await this.store.apply(row.deckId, undefined, row.changedAt);
          changed = true;
        }
      } else if (!local || local.deleted || local.changedAt !== row.changedAt) {
        await this.store.apply(row.deckId, row.deck, row.changedAt);
        changed = true;
      }
    }
    await this.meta.setMeta(this.cursorKey, latest ?? new Date(0).toISOString());
    return changed;
  }
}
