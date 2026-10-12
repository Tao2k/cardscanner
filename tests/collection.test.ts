import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CollectionService, type ScanInput } from '../src/core/collection';
import { IndexedDbStore } from '../src/storage/indexeddb';

let dbCounter = 0;
const service = () => new CollectionService(new IndexedDbStore(`test-${dbCounter++}`));
const scan = (patch: Partial<ScanInput> = {}): ScanInput => ({
  gameId: 'riftbound',
  printingId: 'ogn-001-298',
  language: 'en',
  finish: 'normal',
  condition: 'NM',
  location: '',
  confirmed: true,
  matchScore: 0.9,
  ...patch,
});

describe('CollectionService', () => {
  it('zählt gleiche Drucke zusammen', async () => {
    const s = service();
    await s.addScan(scan());
    await s.addScan(scan());
    const items = await s.list();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it('trennt Foil, Zustand, Lagerort und ungeprüfte Treffer', async () => {
    const s = service();
    await s.addScan(scan());
    await s.addScan(scan({ finish: 'foil' }));
    await s.addScan(scan({ condition: 'LP' }));
    await s.addScan(scan({ location: 'Binder 2' }));
    await s.addScan(scan({ confirmed: false }));
    await s.addScan(scan({ language: 'fr' }));
    await s.addScan(scan({ language: 'zh-CN' }));
    expect(await s.list()).toHaveLength(7);
  });

  it('macht Hinzufügen rückgängig', async () => {
    const s = service();
    const first = await s.addScan(scan());
    const second = await s.addScan(scan());
    await s.undo(second);
    expect((await s.list())[0].quantity).toBe(1);
    await s.undo(first);
    expect(await s.list()).toHaveLength(0);
  });

  it('bestätigt und korrigiert unsichere Treffer', async () => {
    const s = service();
    const { item } = await s.addScan(scan({ confirmed: false, alternatives: ['ogn-002-298'] }));
    const fixed = await s.confirm(item.itemId, 'ogn-002-298');
    expect(fixed).toMatchObject({ printingId: 'ogn-002-298', confirmed: true });
  });

  it('löscht Einträge mit Anzahl 0', async () => {
    const s = service();
    const { item } = await s.addScan(scan());
    await s.update(item.itemId, { quantity: 0 });
    expect(await s.list()).toHaveLength(0);
  });

  it('behandelt Einträge ohne Sprache (ältere Version) als englisch und zählt sie zusammen', async () => {
    const store = new IndexedDbStore(`test-${dbCounter++}`);
    const s = new CollectionService(store);
    const { item } = await s.addScan(scan());
    const { language: _drop, ...legacy } = item;
    await store.put(legacy as typeof item);
    expect((await s.list())[0].language).toBe('en');
    await s.addScan(scan());
    expect(await s.list()).toMatchObject([{ quantity: 2, language: 'en' }]);
  });

  it('filtert nach Spiel', async () => {
    const s = service();
    await s.addScan(scan());
    await s.addScan(scan({ gameId: 'mtg', printingId: 'x' }));
    expect(await s.list('mtg')).toHaveLength(1);
  });
});
