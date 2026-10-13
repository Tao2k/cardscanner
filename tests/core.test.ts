import { describe, expect, it } from 'vitest';
import { collapseToPrintings, l2normalize, topK } from '../src/core/matcher';
import { averageMatches, CALIBRATION, confidenceOf, DEFAULT_STABILIZER, Stabilizer } from '../src/core/stabilizer';
import { strictness } from '../src/app/stats';
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

  it('fasst mehrere Referenzbilder desselben Drucks zusammen', () => {
    const rows = [
      { index: 0, score: 0.9 },
      { index: 1, score: 0.85 },
      { index: 2, score: 0.8 },
    ];
    // Zeilen 0 und 1 gehören zu Druck 5 (englisches und chinesisches Bild), Zeile 2 zu Druck 7.
    const refs = [5, 5, 7];
    expect(collapseToPrintings(rows, (r) => refs[r], 2)).toEqual([
      { index: 5, score: 0.9 },
      { index: 7, score: 0.8 },
    ]);
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
  const cfg = (requiredFrames: number, maxFrames = 5) => ({ requiredFrames, maxFrames, minScore: 0.5, confidentMargin: 0.05, candidates: 4 });

  it('meldet erst nach mehreren Frames und nur einmal pro Karte', () => {
    const s = new Stabilizer(cfg(3));
    expect(s.push(m(1, 0.9))).toBeNull();
    expect(s.push(m(1, 0.9))).toBeNull();
    const hit = s.push(m(1, 0.9));
    expect(hit).toMatchObject({ index: 1, confident: true, alternatives: [101], frames: 3 });
    expect(s.push(m(1, 0.9))).toBeNull();
    expect(s.push(m(1, 0.9))).toBeNull();
  });

  it('meldet dieselbe Karte erneut, nachdem sie das Bild verlassen hat', () => {
    const s = new Stabilizer(cfg(1));
    expect(s.push(m(1, 0.9))).not.toBeNull();
    expect(s.push(m(1, 0.9))).toBeNull();
    expect(s.push([])).toBeNull();
    expect(s.push(m(1, 0.9))).not.toBeNull();
  });

  it('sammelt bei knappen Treffern weiter und fragt erst nach maxFrames nach', () => {
    const s = new Stabilizer(cfg(1, 4));
    for (let i = 0; i < 3; i++) expect(s.push(m(7, 0.8, 0.78))).toBeNull();
    const ask = s.push(m(7, 0.8, 0.78));
    expect(ask).toMatchObject({ index: 7, confident: false, alternatives: [107], frames: 4 });
    // Solange einer der gezeigten Kandidaten vorne liegt, ist es dieselbe Karte
    expect(s.push(m(107, 0.8, 0.78))).toBeNull();
  });

  it('wird durch mehr Frames sicher, wenn der Favorit klar vorne bleibt', () => {
    const s = new Stabilizer(cfg(2, 10));
    // Ein Frame knapp, dann klar: im Mittel sicher
    expect(s.push(m(3, 0.8, 0.79))).toBeNull();
    expect(s.push(m(3, 0.9, 0.7))?.confident).toBe(true);
  });

  it('ignoriert Frames unter der Mindestähnlichkeit', () => {
    const s = new Stabilizer(cfg(1));
    expect(s.push(m(1, 0.4))).toBeNull();
  });

  it('springt bei Kartenwechsel neu an', () => {
    const s = new Stabilizer(cfg(2));
    s.push(m(1, 0.9));
    expect(s.push(m(2, 0.9))).toBeNull();
    expect(s.push(m(2, 0.9))?.index).toBe(2);
  });

  it('speichert ohne Nachfrage nur ab 95 % geschätzter Sicherheit', () => {
    expect(confidenceOf(DEFAULT_STABILIZER.confidentMargin)).toBeGreaterThanOrEqual(0.95);
    // Sicherheit steigt nie, wenn der Abstand kleiner wird
    for (let i = 1; i < CALIBRATION.length; i++) expect(CALIBRATION[i].p).toBeGreaterThanOrEqual(CALIBRATION[i - 1].p);
    expect(confidenceOf(0.012)).toBeLessThan(0.95);
  });

  it('verlangt mehr Abstand, wenn viele Treffer als falsch gemeldet werden', () => {
    expect(strictness({ auto: 10, wrong: 5, right: 0, asked: 0 })).toBe(0);
    expect(strictness({ auto: 100, wrong: 5, right: 0, asked: 0 })).toBe(0);
    expect(strictness({ auto: 100, wrong: 7, right: 0, asked: 0 })).toBeCloseTo(0.01);
    expect(strictness({ auto: 100, wrong: 50, right: 0, asked: 0 })).toBeCloseTo(0.06);
  });

  it('mittelt Treffer über Frames, fehlende zählen mit dem schlechtesten Wert', () => {
    const avg = averageMatches([
      [{ index: 1, score: 0.9 }, { index: 2, score: 0.7 }],
      [{ index: 2, score: 0.85 }, { index: 3, score: 0.6 }],
    ]);
    expect(avg.map((x) => x.index)).toEqual([2, 1, 3]);
    expect(avg[0].score).toBeCloseTo(0.775);
    expect(avg[1].score).toBeCloseTo(0.75);
    expect(avg[2].score).toBeCloseTo(0.65);
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
