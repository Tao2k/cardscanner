import { describe, expect, it } from 'vitest';
import { AdaptiveIndex, adapt } from '../src/core/learning';
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
