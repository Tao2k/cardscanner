import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'cardscanner';
export const COLLECTION = 'collection';
export const SAMPLES = 'samples';

/** Eine gemeinsame Datenbank im Browser: Sammlung (v1) und eigene Scans zum Lernen (v2). */
export function openAppDb(dbName = DB_NAME): Promise<IDBPDatabase> {
  return openDB(dbName, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(COLLECTION, { keyPath: 'itemId' });
        store.createIndex('gameId', 'gameId');
        store.createIndex('printingId', 'printingId');
      }
      if (oldVersion < 2) {
        const samples = db.createObjectStore(SAMPLES, { keyPath: 'sampleId' });
        samples.createIndex('gameId', 'gameId');
        samples.createIndex('itemId', 'itemId');
      }
    },
  });
}
