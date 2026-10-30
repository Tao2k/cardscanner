import { openDB, type IDBPDatabase } from 'idb';
import { conditionFromLegacy } from '../core/types';

export const DB_NAME = 'cardscanner';
export const COLLECTION = 'collection';
export const SAMPLES = 'samples';
export const OUTBOX = 'outbox';
export const META = 'meta';
export const DECKS = 'decks';

/**
 * Eine gemeinsame Datenbank im Browser: Sammlung (v1), eigene Scans zum Lernen (v2) sowie
 * Warteschlange und Stand für den Abgleich mit dem Server (v3). v4 stellt den Zustand auf die Cardmarket-Stufen um,
 * v5 bringt die Decks.
 */
export function openAppDb(dbName = DB_NAME): Promise<IDBPDatabase> {
  return openDB(dbName, 5, {
    async upgrade(db, oldVersion, _newVersion, tx) {
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
      if (oldVersion >= 1 && oldVersion < 4) {
        for (let c = await tx.objectStore(COLLECTION).openCursor(); c; c = await c.continue()) {
          await c.update({ ...c.value, condition: conditionFromLegacy(c.value.condition) });
        }
        for (let c = await tx.objectStore(OUTBOX).openCursor(); c; c = await c.continue()) {
          if (c.value.item) await c.update({ ...c.value, item: { ...c.value.item, condition: conditionFromLegacy(c.value.item.condition) } });
        }
      }
      if (oldVersion < 5) db.createObjectStore(DECKS, { keyPath: 'deckId' });
    },
  });
}
