import type { IDBPDatabase } from 'idb';
import type { CollectionItem, GameId } from '../core/types';
import { DB_NAME, META, OUTBOX, openAppDb } from './db';
import { IndexedDbStore } from './indexeddb';
import type { CollectionStore } from './store';

/** Eine lokale Änderung, die noch zum Server muss. Je Eintrag zählt nur die letzte. */
export interface PendingChange {
  itemId: string;
  /** Stand des Eintrags; fehlt, wenn er gelöscht wurde. */
  item?: CollectionItem;
  deleted: boolean;
  changedAt: string;
}

/** Warteschlange der Änderungen und kleiner Merkzettel (z. B. Stand des letzten Abgleichs). */
export class Outbox {
  private db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.db = openAppDb(dbName);
  }

  async list(): Promise<PendingChange[]> {
    return (await this.db).getAll(OUTBOX);
  }

  async has(itemId: string): Promise<boolean> {
    return (await (await this.db).getKey(OUTBOX, itemId)) !== undefined;
  }

  async add(change: PendingChange): Promise<void> {
    await (await this.db).put(OUTBOX, change);
  }

  /** Entfernt gesendete Änderungen, außer der Eintrag wurde inzwischen erneut geändert. */
  async done(sent: PendingChange[]): Promise<void> {
    const tx = (await this.db).transaction(OUTBOX, 'readwrite');
    for (const change of sent) {
      const current: PendingChange | undefined = await tx.store.get(change.itemId);
      if (current && JSON.stringify(current) === JSON.stringify(change)) await tx.store.delete(change.itemId);
    }
    await tx.done;
  }

  async clear(): Promise<void> {
    await (await this.db).clear(OUTBOX);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db).get(META, key);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.db;
    if (value === undefined) await db.delete(META, key);
    else await db.put(META, value, key);
  }
}

/**
 * Sammlung im Browser, die jede Änderung zusätzlich in die Warteschlange legt.
 * Die App arbeitet damit offline wie bisher; der Abgleich (core/sync.ts) schickt die Warteschlange
 * zum Server, sobald jemand angemeldet und online ist.
 */
export class SyncingStore implements CollectionStore {
  constructor(
    readonly local: IndexedDbStore = new IndexedDbStore(),
    readonly outbox: Outbox = new Outbox(),
    private readonly now: () => Date = () => new Date(),
    /** Wird nach jeder Änderung aufgerufen, damit der Abgleich bald startet. */
    public onChange: () => void = () => {},
  ) {}

  list(gameId?: GameId) {
    return this.local.list(gameId);
  }

  get(itemId: string) {
    return this.local.get(itemId);
  }

  async put(item: CollectionItem): Promise<void> {
    await this.local.put(item);
    await this.outbox.add({ itemId: item.itemId, item, deleted: false, changedAt: this.now().toISOString() });
    this.onChange();
  }

  async remove(itemId: string): Promise<void> {
    await this.local.remove(itemId);
    await this.outbox.add({ itemId, deleted: true, changedAt: this.now().toISOString() });
    this.onChange();
  }

  /** Excel-Import: was in der neuen Sammlung fehlt, gilt auch auf dem Server als gelöscht. */
  async replaceAll(items: CollectionItem[]): Promise<void> {
    const before = await this.local.list();
    await this.local.replaceAll(items);
    const changedAt = this.now().toISOString();
    const kept = new Set(items.map((i) => i.itemId));
    for (const old of before) if (!kept.has(old.itemId)) await this.outbox.add({ itemId: old.itemId, deleted: true, changedAt });
    for (const item of items) await this.outbox.add({ itemId: item.itemId, item, deleted: false, changedAt });
    this.onChange();
  }
}
