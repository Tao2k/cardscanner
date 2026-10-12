import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { AdaptiveIndex, adapt, LearningService } from '../src/core/learning';
import { IndexedDbSampleStore, IndexedDbStore } from '../src/storage/indexeddb';
import { l2normalize } from '../src/core/matcher';

const unit = (...v: number[]) => l2normalize(Float32Array.from(v));

// Drei Drucke, Druck 2 hat zwei Referenzbilder (z. B. EN und ZH)
const catalog = new Float32Array([...unit(1, 0, 0, 0), ...unit(0, 1, 0, 0), ...unit(0, 0, 1, 0), ...unit(0, 0, 0.9, 0.1)]);
const refs = [0, 1, 2, 2];

describe('AdaptiveIndex', () => {
  it('sucht ohne eigene Scans wie der Katalog', () => {
    const index = new AdaptiveIndex(catalog, refs, 4);
    expect(index.search(unit(0.1, 1, 0, 0), 2).map((m) => m.index)).toEqual([1, 0]);
  });

  it('erkennt eine Karte über ein bestätigtes eigenes Foto', () => {
    const index = new AdaptiveIndex(catalog, refs, 4, { minShiftSamples: Infinity, shrink: 0, samplePenalty: 0.02 });
    // Das Foto von Druck 0 sieht im Embedding eher wie Druck 1 aus
    const photo = unit(0.6, 0.8, 0, 0.3);
    expect(index.search(photo, 1)[0].index).toBe(1);
    index.setSamples([{ vector: photo, printing: 0, source: 'user' }]);
    expect(index.userSamples).toBe(1);
    expect(index.search(unit(0.6, 0.8, 0, 0.31), 1)[0].index).toBe(0);
  });

  it('ignoriert unbestätigte Scans und zieht die Kamera-Verschiebung ab', () => {
    const index = new AdaptiveIndex(catalog, refs, 4, { minShiftSamples: 2, shrink: 0, samplePenalty: 0 });
    // Alle Fotos haben einen Stich in Richtung der vierten Dimension
    const tint = (v: number[]) => unit(v[0], v[1], v[2], v[3] + 0.8);
    index.setSamples([
      { vector: tint([1, 0, 0, 0]), printing: 0, source: 'auto' },
      { vector: tint([0, 1, 0, 0]), printing: 1, source: 'auto' },
      { vector: tint([0, 0, 0, 0]), printing: 1, source: 'pending' },
    ]);
    expect(index.shiftSamples).toBe(2);
    expect(index.userSamples).toBe(0);
    const res = index.search(tint([0, 0, 1, 0]), 2);
    expect(res[0].index).toBe(2);
    expect(res[0].score).toBeGreaterThan(0.9);
  });

  it('adapt verändert den Eingabevektor nicht', () => {
    const v = unit(1, 1, 0, 0);
    adapt(v, Float32Array.from([1, 0, 0, 0]));
    expect(Array.from(v)).toEqual(Array.from(unit(1, 1, 0, 0)));
  });
});

describe('LearningService', () => {
  it('macht bestätigte Scans zu Referenzbildern und vergisst unbestätigte beim Löschen', async () => {
    const store = new IndexedDbSampleStore(`learn-${Math.random()}`);
    const learning = new LearningService(store);
    const vector = unit(1, 0, 0, 0);
    const a = await learning.recordScan({ gameId: 'g', printingId: 'p1', itemId: 'i1', vector, confident: false });
    await learning.recordScan({ gameId: 'g', printingId: 'p1', itemId: 'i1', vector, confident: false });
    await learning.recordScan({ gameId: 'g', printingId: 'p2', itemId: 'i2', vector, confident: true });
    await learning.recordScan({ gameId: 'g', printingId: 'p3', itemId: 'i3', vector, confident: false });
    expect(a.source).toBe('pending');

    expect(await learning.confirmItem('i1', 'p9')).toBe(2);
    await learning.itemRemoved('i3');
    const all = await store.list('g');
    expect(all.filter((s) => s.source === 'user').map((s) => s.printingId)).toEqual(['p9', 'p9']);
    expect(all).toHaveLength(3);
    expect(all[0].vector).toBeInstanceOf(Float32Array);
    expect(await learning.counts('g')).toEqual({ user: 2, auto: 1 });

    await learning.reset('g');
    expect(await store.list('g')).toEqual([]);
  });

  it('übernimmt die Sammlung aus der alten Datenbank', async () => {
    const name = `old-${Math.random()}`;
    const old = await openDB(name, 1, { upgrade: (db) => db.createObjectStore('collection', { keyPath: 'itemId' }).createIndex('gameId', 'gameId') });
    await old.put('collection', { itemId: 'x', gameId: 'g' });
    old.close();
    expect(await new IndexedDbStore(name).list()).toHaveLength(1);
    expect(await new IndexedDbSampleStore(name).list()).toEqual([]);
  });
});
