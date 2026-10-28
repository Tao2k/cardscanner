import type { PendingChange, SyncingStore } from '../storage/outbox';
import type { CollectionItem } from './types';

/** Ein Eintrag, wie er auf dem Server liegt. */
export interface RemoteRow {
  itemId: string;
  /** Fehlt bei gelöschten Einträgen. */
  item?: CollectionItem;
  deleted: boolean;
  /** Zeitpunkt, zu dem der Server die Zeile zuletzt geschrieben hat (für „seit dem letzten Abgleich“). */
  serverUpdatedAt: string;
}

/** Die Sammlung einer angemeldeten Person auf dem Server. */
export interface RemoteCollection {
  /** Schickt lokale Änderungen. Der Server behält je Eintrag die neueste Änderung (changedAt). */
  push(changes: PendingChange[]): Promise<void>;
  /** Alle Zeilen, die der Server seit `since` geschrieben hat; null = alle. */
  pull(since: string | null): Promise<RemoteRow[]>;
  /** Anzahl nicht gelöschter Einträge auf dem Server. */
  count(): Promise<number>;
}

export type FirstSync = 'merge' | 'server';

export interface SyncResult {
  pushed: number;
  /** Lokale Sammlung wurde durch den Server verändert (Anzeige neu laden). */
  changed: boolean;
}

/**
 * Zeilen, die kurz vor dem letzten Stand geschrieben, aber erst danach sichtbar wurden, kommen
 * so trotzdem an. Doppelt geholte Zeilen schaden nicht.
 */
const OVERLAP_MS = 10_000;

/**
 * Abgleich der lokalen Sammlung mit dem Server, lokal zuerst:
 * erst die Warteschlange senden, dann alles holen, was sich auf dem Server seitdem geändert hat.
 * Was noch in der Warteschlange liegt, ist neuer als der Server und bleibt lokal unverändert.
 */
export class SyncEngine {
  constructor(
    private readonly store: SyncingStore,
    private readonly remote: RemoteCollection,
    private readonly userId: string,
  ) {}

  private get cursorKey() {
    return `cursor:${this.userId}`;
  }

  /** Noch nie mit diesem Konto abgeglichen. */
  async isFirst(): Promise<boolean> {
    return (await this.store.outbox.getMeta<string>(this.cursorKey)) === undefined;
  }

  /**
   * Erste Anmeldung auf diesem Gerät. Liegen hier und auf dem Server schon Karten, muss die Person
   * wählen: zusammenführen (die Karten dieses Geräts kommen dazu) oder den Server-Stand übernehmen.
   * Ergebnis: Anzahl der Einträge auf dem Server, 0 = keine Frage nötig.
   */
  async needsChoice(): Promise<number> {
    if (!(await this.isFirst())) return 0;
    if (!(await this.store.local.list()).length) return 0;
    return this.remote.count();
  }

  async first(mode: FirstSync): Promise<SyncResult> {
    if (mode === 'server') {
      await this.store.local.replaceAll([]);
      await this.store.outbox.clear();
    } else {
      // Alles, was schon vor der Anmeldung da war, einmal hochladen
      const changedAt = new Date().toISOString();
      for (const item of await this.store.local.list()) {
        if (!(await this.store.outbox.has(item.itemId))) await this.store.outbox.add({ itemId: item.itemId, item, deleted: false, changedAt });
      }
    }
    const result = await this.sync();
    return { ...result, changed: result.changed || mode === 'server' };
  }

  async sync(): Promise<SyncResult> {
    const { local, outbox } = this.store;
    const pending = await outbox.list();
    if (pending.length) {
      await this.remote.push(pending);
      await outbox.done(pending);
    }
    const cursor = await outbox.getMeta<string>(this.cursorKey);
    const rows = await this.remote.pull(cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null);
    let latest = cursor;
    let changed = false;
    for (const row of rows) {
      if (!latest || row.serverUpdatedAt > latest) latest = row.serverUpdatedAt;
      if (await outbox.has(row.itemId)) continue;
      const current = await local.get(row.itemId);
      if (row.deleted || !row.item) {
        if (current) {
          await local.remove(row.itemId);
          changed = true;
        }
      } else if (!current || !sameItem(current, row.item)) {
        await local.put(row.item);
        changed = true;
      }
    }
    await outbox.setMeta(this.cursorKey, latest ?? new Date(0).toISOString());
    return { pushed: pending.length, changed };
  }
}

function sameItem(a: CollectionItem, b: CollectionItem): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof CollectionItem)[]);
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
}
