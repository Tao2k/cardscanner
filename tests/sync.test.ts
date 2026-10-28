import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CollectionService, type ScanInput } from '../src/core/collection';
import { SyncEngine, type RemoteCollection, type RemoteRow } from '../src/core/sync';
import { IndexedDbStore } from '../src/storage/indexeddb';
import { Outbox, SyncingStore, type PendingChange } from '../src/storage/outbox';

/** Server im Speicher, verhält sich wie die Tabelle in supabase/migrations (neueste Änderung gewinnt). */
class FakeRemote implements RemoteCollection {
  rows = new Map<string, RemoteRow & { changedAt: string }>();
  private clock = 0;
  pushes = 0;

  async push(changes: PendingChange[]) {
    this.pushes++;
    for (const c of changes) {
      const old = this.rows.get(c.itemId);
      if (old && c.changedAt < old.changedAt) continue;
      const serverUpdatedAt = new Date(Date.UTC(2026, 9, 28, 12, 0, 0, ++this.clock * 1000 * 60)).toISOString();
      this.rows.set(c.itemId, { itemId: c.itemId, item: c.deleted ? undefined : c.item, deleted: c.deleted, changedAt: c.changedAt, serverUpdatedAt });
    }
  }

  async pull(since: string | null) {
    return [...this.rows.values()].filter((r) => !since || r.serverUpdatedAt >= since).sort((a, b) => a.serverUpdatedAt.localeCompare(b.serverUpdatedAt));
  }

  async count() {
    return [...this.rows.values()].filter((r) => !r.deleted).length;
  }
}

let dbCounter = 0;
/** Ein Gerät mit eigener Datenbank im Browser. */
function device(remote: RemoteCollection, user = 'u1') {
  const name = `sync-${dbCounter++}`;
  const store = new SyncingStore(new IndexedDbStore(name), new Outbox(name));
  return { store, service: new CollectionService(store), engine: new SyncEngine(store, remote, user) };
}

const scan = (patch: Partial<ScanInput> = {}): ScanInput => ({
  gameId: 'riftbound',
  printingId: 'ogn-001-298',
  language: 'en',
  finish: 'normal',
  condition: 'NM',
  location: '',
  confirmed: true,
  ...patch,
});

/** Anmelden wie in der App: vorbereiten, dann abgleichen. */
async function signIn(d: ReturnType<typeof device>) {
  await d.engine.prepare();
  return d.engine.sync();
}

describe('Abgleich mit dem Server', () => {
  it('legt jede Änderung in die Warteschlange und leert sie beim Abgleich', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.service.addScan(scan());
    await a.service.addScan(scan());
    expect(await a.store.outbox.list()).toHaveLength(1);
    await signIn(a);
    expect(await a.store.outbox.list()).toHaveLength(0);
    expect(await remote.count()).toBe(1);
    expect([...remote.rows.values()][0].item?.quantity).toBe(2);
  });

  it('bringt Karten, Änderungen und Löschungen auf ein zweites Gerät', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    const { item } = await a.service.addScan(scan());
    await a.service.addScan(scan({ printingId: 'ogn-002-298' }));
    await signIn(a);

    expect((await signIn(b)).changed).toBe(true);
    expect(await b.service.list()).toHaveLength(2);

    await b.service.update(item.itemId, { quantity: 4 });
    await b.service.remove((await b.service.list()).find((i) => i.printingId === 'ogn-002-298')!.itemId);
    await b.engine.sync();
    expect((await a.engine.sync()).changed).toBe(true);
    const onA = await a.service.list();
    expect(onA).toHaveLength(1);
    expect(onA[0].quantity).toBe(4);
  });

  it('lädt Karten von vor der Anmeldung beim ersten Mal automatisch hoch', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    await a.service.addScan(scan());
    await signIn(a);

    const b = device(remote);
    await b.service.addScan(scan({ printingId: 'ogn-003-298' }));
    await signIn(b);
    expect(await b.service.list()).toHaveLength(2);
    expect(await remote.count()).toBe(2);
    // erneute Anmeldung desselben Kontos lädt nichts doppelt hoch
    await signIn(b);
    expect(await remote.count()).toBe(2);
  });

  it('Abmelden und anderes Konto: Gerätespeicher gehört nur dem angemeldeten Konto', async () => {
    const remote = new FakeRemote();
    const other = new FakeRemote();
    const name = `sync-${dbCounter++}`;
    const store = new SyncingStore(new IndexedDbStore(name), new Outbox(name));
    const yalisa = new SyncEngine(store, remote, 'yalisa');
    await new CollectionService(store).addScan(scan());
    await yalisa.prepare();
    await yalisa.sync();

    // anderes Konto meldet sich auf demselben Gerät an: Yalisas Karten verschwinden vom Gerät, nicht vom Server
    const friend = new SyncEngine(store, other, 'freundin');
    await friend.prepare();
    await friend.sync();
    expect(await store.list()).toHaveLength(0);
    expect(await other.count()).toBe(0);
    expect(await remote.count()).toBe(1);

    await friend.clearLocal();
    await yalisa.prepare();
    await yalisa.sync();
    expect(await store.list()).toHaveLength(1);
  });

  it('bei Änderungen auf zwei Geräten gewinnt die spätere', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const b = device(remote);
    const { item } = await a.service.addScan(scan());
    await signIn(a);
    await signIn(b);

    await a.service.update(item.itemId, { quantity: 3 });
    await a.engine.sync();
    // b ändert offline, bevor es den Stand von a kennt; die spätere Änderung gewinnt
    await new Promise((r) => setTimeout(r, 5));
    await b.service.update(item.itemId, { quantity: 7 });
    await b.engine.sync();
    await a.engine.sync();
    expect((await a.store.get(item.itemId))?.quantity).toBe(7);
    expect((await b.service.list())[0].quantity).toBe(7);
  });

  it('Excel-Import ersetzt die Sammlung auch auf dem Server', async () => {
    const remote = new FakeRemote();
    const a = device(remote);
    const { item } = await a.service.addScan(scan());
    await signIn(a);
    await a.service.replaceAll([{ ...item, itemId: 'neu', printingId: 'ogn-005-298' }]);
    await a.engine.sync();
    expect(await remote.count()).toBe(1);
    expect(remote.rows.get(item.itemId)?.deleted).toBe(true);
  });
});
