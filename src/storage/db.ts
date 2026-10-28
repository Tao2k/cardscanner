import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'cardscanner';
export const COLLECTION = 'collection';
export const SAMPLES = 'samples';
export const OUTBOX = 'outbox';
export const META = 'meta';

/**
 * Eine gemeinsame Datenbank im Browser: Sammlung (v1), eigene Scans zum Lernen (v2) sowie
 * Warteschlange und Stand für den Abgleich mit dem Server (v3).
 */
export function openAppDb(dbName = DB_NAME): Promise<IDBPDatabase> {
  return openDB(dbName, 3, {
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
      if (oldVersion < 3) {
        db.createObjectStore(OUTBOX, { keyPath: 'itemId' });
        db.createObjectStore(META);
      }
    },
  });
}
