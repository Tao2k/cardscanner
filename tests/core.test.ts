import { describe, expect, it } from 'vitest';
import { l2normalize, topK } from '../src/core/matcher';
import { Stabilizer } from '../src/core/stabilizer';
import { boxToVideo, CARD_ASPECT, guideRect } from '../src/core/geometry';
import { letterboxToSquare, toPortrait } from '../src/core/imageops';
import { parseEmbeddings } from '../src/core/catalog';
import type { CatalogMeta } from '../src/core/types';

describe('matcher', () => {
  it('findet den ähnlichsten Vektor zuerst', () => {
    const dim = 3;
    const emb = new Float32Array([1, 0, 0, 0, 1, 0, 0.7071, 0.7071, 0]);
    const q = l2normalize(new Float32Array([0.9, 0.1, 0]));
    const res = topK(q, emb, dim, 2);
    expect(res.map((m) => m.index)).toEqual([0, 2]);
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  it('lehnt falsche Dimension ab', () => {
    expect(() => topK(new Float32Array(2), new Float32Array(6), 3, 1)).toThrow();
  });
});

describe('stabilizer', () => {
  const m = (index: number, score: number, second = 0.1) => [
    { index, score },
    { index: index + 100, score: second },
  ];

  it('meldet erst nach mehreren stabilen Frames und nur einmal pro Karte', () => {
    const s = new Stabilizer({ requiredFrames: 3, minScore: 0.5, confidentMargin: 0.05 });
    expect(s.push(m(1, 0.9))).toBeNull();
    expect(s.push(m(1, 0.9))).toBeNull();
    const hit = s.push(m(1, 0.9));
    expect(hit).toMatchObject({ index: 1, confident: true, alternatives: [101] });
    expect(s.push(m(1, 0.9))).toBeNull();
    expect(s.push(m(1, 0.9))).toBeNull();
  });

  it('meldet dieselbe Karte erneut, nachdem sie das Bild verlassen hat', () => {
    const s = new Stabilizer({ requiredFrames: 1, minScore: 0.5, confidentMargin: 0.05 });
    expect(s.push(m(1, 0.9))).not.toBeNull();
    expect(s.push(m(1, 0.9))).toBeNull();
    expect(s.push([])).toBeNull();
    expect(s.push(m(1, 0.9))).not.toBeNull();
  });

  it('markiert knappe Treffer als unsicher', () => {
    const s = new Stabilizer({ requiredFrames: 1, minScore: 0.5, confidentMargin: 0.05 });
    expect(s.push(m(7, 0.8, 0.78))?.confident).toBe(false);
  });

  it('ignoriert Frames unter der Mindestähnlichkeit', () => {
    const s = new Stabilizer({ requiredFrames: 1, minScore: 0.5, confidentMargin: 0.05 });
    expect(s.push(m(1, 0.4))).toBeNull();
  });

  it('springt bei Kartenwechsel neu an', () => {
    const s = new Stabilizer({ requiredFrames: 2, minScore: 0.5, confidentMargin: 0.05 });
    s.push(m(1, 0.9));
    expect(s.push(m(2, 0.9))).toBeNull();
    expect(s.push(m(2, 0.9))?.index).toBe(2);
  });
});

describe('geometry', () => {
  it('Zielrahmen hat Kartenformat und liegt mittig', () => {
    const r = guideRect(400, 600);
    expect(r.width / r.height).toBeCloseTo(CARD_ASPECT);
    expect(r.x + r.width / 2).toBeCloseTo(200);
    expect(r.y + r.height / 2).toBeCloseTo(300);
  });

  it('rechnet Bildschirm- in Videokoordinaten um (object-fit: cover)', () => {
    // Querformat-Video 1920×1080 in Hochformat-Box 360×640: Höhe füllt, Seiten werden abgeschnitten.
    const r = boxToVideo({ x: 0, y: 0, width: 360, height: 640 }, 1920, 1080, 360, 640);
    expect(r.height).toBeCloseTo(1080);
    expect(r.width).toBeCloseTo(607.5);
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2);
    expect(r.y).toBeCloseTo(0);
  });
});

describe('imageops', () => {
  const img = (w: number, h: number) => ({
    data: Uint8ClampedArray.from({ length: w * h * 3 }, (_, i) => i % 256),
    width: w,
    height: h,
    channels: 3 as const,
  });

  it('dreht Querformat ins Hochformat', () => {
    const src = img(3, 2);
    const out = toPortrait(src);
    expect([out.width, out.height]).toEqual([2, 3]);
    // Pixel oben links der Quelle (0,0) landet oben rechts (x = h-1, y = 0).
    expect(Array.from(out.data.slice((0 * 2 + 1) * 3, (0 * 2 + 1) * 3 + 3))).toEqual([0, 1, 2]);
  });

  it('lässt Hochformat unverändert', () => {
    const src = img(2, 3);
    expect(toPortrait(src)).toBe(src);
  });

  it('füllt auf ein Quadrat auf und zentriert', () => {
    const src = { data: new Uint8ClampedArray(2 * 4 * 4).fill(255), width: 2, height: 4, channels: 4 as const };
    const out = letterboxToSquare(src);
    expect([out.width, out.height, out.channels]).toEqual([4, 4, 3]);
    expect(out.data[0]).toBe(128); // Rand links
    expect(out.data[(0 * 4 + 1) * 3]).toBe(255); // Bild ab Spalte 1
  });
});

describe('catalog', () => {
  it('prüft die Größe der Embedding-Datei', () => {
    const meta = { count: 2, dim: 3 } as CatalogMeta;
    expect(parseEmbeddings(new Float32Array(6).buffer, meta)).toHaveLength(6);
    expect(() => parseEmbeddings(new Float32Array(5).buffer, meta)).toThrow();
  });
});
