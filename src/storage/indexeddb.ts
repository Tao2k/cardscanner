import type { IDBPDatabase } from 'idb';
import type { CollectionItem, GameId } from '../core/types';
import type { Sample } from '../core/learning';
import { COLLECTION as STORE, DB_NAME, openAppDb, SAMPLES } from './db';
import type { CollectionStore, SampleStore } from './store';

export class IndexedDbStore implements CollectionStore {
  private db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.db = openAppDb(dbName);
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

export class IndexedDbSampleStore implements SampleStore {
  private db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.db = openAppDb(dbName);
  }

  async list(gameId?: GameId): Promise<Sample[]> {
    const db = await this.db;
    return gameId ? db.getAllFromIndex(SAMPLES, 'gameId', gameId) : db.getAll(SAMPLES);
  }

  async forItem(itemId: string): Promise<Sample[]> {
    return (await this.db).getAllFromIndex(SAMPLES, 'itemId', itemId);
  }

  async put(sample: Sample): Promise<void> {
    await (await this.db).put(SAMPLES, sample);
  }

  async remove(sampleId: string): Promise<void> {
    await (await this.db).delete(SAMPLES, sampleId);
  }

  async clear(gameId: GameId): Promise<void> {
    const tx = (await this.db).transaction(SAMPLES, 'readwrite');
    for (const key of await tx.store.index('gameId').getAllKeys(gameId)) await tx.store.delete(key);
    await tx.done;
  }
}
