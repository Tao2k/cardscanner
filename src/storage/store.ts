import type { CollectionItem, GameId } from '../core/types';
import type { Sample } from '../core/learning';

/**
 * Speicher für die Sammlung einer Person.
 *
 * Heute gibt es nur die lokale Umsetzung im Browser (IndexedDB). Ein späterer Server-Betrieb
 * braucht nur eine weitere Umsetzung dieses Interfaces (z. B. per HTTP); die App selbst
 * spricht ausschließlich über dieses Interface mit dem Speicher.
 */
export interface CollectionStore {
  list(gameId?: GameId): Promise<CollectionItem[]>;
  get(itemId: string): Promise<CollectionItem | undefined>;
  put(item: CollectionItem): Promise<void>;
  remove(itemId: string): Promise<void>;
  /** Ersetzt die komplette Sammlung, z. B. beim Excel-Import. */
  replaceAll(items: CollectionItem[]): Promise<void>;
}

/** Eigene Scans, aus denen die Erkennung lernt (siehe core/learning.ts). */
export interface SampleStore {
  list(gameId?: GameId): Promise<Sample[]>;
  forItem(itemId: string): Promise<Sample[]>;
  put(sample: Sample): Promise<void>;
  remove(sampleId: string): Promise<void>;
  clear(gameId: GameId): Promise<void>;
}
