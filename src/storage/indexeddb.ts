import { openDB, type IDBPDatabase } from 'idb';
import type { CollectionItem, GameId } from '../core/types';
import type { CollectionStore } from './store';

const DB_NAME = 'cardscanner';
const STORE = 'collection';

export class IndexedDbStore implements CollectionStore {
  private db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.db = openDB(dbName, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'itemId' });
        store.createIndex('gameId', 'gameId');
        store.createIndex('printingId', 'printingId');
      },
    });
  }

  async list(gameId?: GameId): Promise<CollectionItem[]> {
    const db = await this.db;
    return gameId ? db.getAllFromIndex(STORE, 'gameId', gameId) : db.getAll(STORE);
  }

  async get(itemId: string): Promise<CollectionItem | undefined> {
    return (await this.db).get(STORE, itemId);
  }

  async put(item: CollectionItem): Promise<void> {
    await (await this.db).put(STORE, item);
  }

  async remove(itemId: string): Promise<void> {
    await (await this.db).delete(STORE, itemId);
  }

  async replaceAll(items: CollectionItem[]): Promise<void> {
    const tx = (await this.db).transaction(STORE, 'readwrite');
    await tx.store.clear();
    for (const item of items) await tx.store.put(item);
    await tx.done;
  }
}
