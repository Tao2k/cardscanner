import type { CollectionStore } from '../storage/store';
import type { CollectionItem, Condition, Finish, GameId, Language } from './types';

export interface ScanInput {
  gameId: GameId;
  printingId: string;
  language: Language;
  finish: Finish;
  condition: Condition;
  location: string;
  confirmed: boolean;
  matchScore?: number;
  alternatives?: string[];
  /** Stückzahl, die dazukommt (von Hand eingetragen); ein Scan ist immer 1. */
  quantity?: number;
}

export interface AddResult {
  item: CollectionItem;
  /** Zustand vor dem Hinzufügen, für „Rückgängig“. undefined = Eintrag war neu. */
  previous?: CollectionItem;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Fachlogik der Sammlung, unabhängig vom Speicherort.
 * Gleiche Drucke mit gleicher Sprache, Finish, Zustand und Lagerort werden zusammengezählt statt doppelt angelegt.
 */
export class CollectionService {
  constructor(private readonly store: CollectionStore, private readonly now: () => Date = () => new Date()) {}

  /** Einträge aus Versionen vor der Sprachunterstützung gelten als englisch. */
  async list(gameId?: GameId): Promise<CollectionItem[]> {
    return (await this.store.list(gameId)).map((i) => (i.language ? i : { ...i, language: 'en' }));
  }

  async addScan(input: ScanInput): Promise<AddResult> {
    const count = Math.max(1, Math.floor(input.quantity ?? 1));
    const timestamp = this.now().toISOString();
    const existing = (await this.list(input.gameId)).find(
      (i) =>
        i.printingId === input.printingId &&
        i.language === input.language &&
        i.finish === input.finish &&
        i.condition === input.condition &&
        i.location === input.location &&
        i.confirmed === input.confirmed,
    );
    if (existing) {
      const item = { ...existing, quantity: existing.quantity + count, updatedAt: timestamp };
      await this.store.put(item);
      return { item, previous: existing };
    }
    const item: CollectionItem = {
      itemId: newId(),
      gameId: input.gameId,
      printingId: input.printingId,
      language: input.language,
      quantity: count,
      condition: input.condition,
      finish: input.finish,
      location: input.location,
      notes: '',
      confirmed: input.confirmed,
      matchScore: input.matchScore,
      alternatives: input.alternatives,
      addedAt: timestamp,
      updatedAt: timestamp,
    };
    await this.store.put(item);
    return { item };
  }

  async undo(result: AddResult): Promise<void> {
    if (result.previous) await this.store.put(result.previous);
    else await this.store.remove(result.item.itemId);
  }

  async update(itemId: string, patch: Partial<Omit<CollectionItem, 'itemId' | 'addedAt'>>): Promise<CollectionItem> {
    const current = await this.store.get(itemId);
    if (!current) throw new Error(`Eintrag ${itemId} nicht gefunden`);
    const item = { ...current, ...patch, updatedAt: this.now().toISOString() };
    if (item.quantity <= 0) {
      await this.store.remove(itemId);
    } else {
      await this.store.put(item);
    }
    return item;
  }

  /** Korrigiert einen unsicheren Treffer auf einen anderen Druck und bestätigt ihn. */
  confirm(itemId: string, printingId?: string) {
    return this.update(itemId, printingId ? { printingId, confirmed: true } : { confirmed: true });
  }

  remove(itemId: string) {
    return this.store.remove(itemId);
  }

  /** Gelöschten Eintrag zurückholen („Rückgängig“), unverändert mit seiner Id. */
  restore(item: CollectionItem) {
    return this.store.put(item);
  }

  replaceAll(items: CollectionItem[]) {
    return this.store.replaceAll(items);
  }
}
