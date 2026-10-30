import { describe, expect, it } from 'vitest';
import { findCard, toGray } from '../src/core/condition';
import { estimateFoil, finishesOf, FOIL_SHARE, learnFoilShare } from '../src/core/foil';
import type { Pixels } from '../src/core/imageops';
import type { Printing } from '../src/core/types';

let seed = 3;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Farbiges Original im Kartenformat: schwarzer Rahmen, darin bunte Flächen. */
function makeReference(w = 252, h = 352): Pixels {
  const data = new Uint8ClampedArray(w * h * 3);
  const blocks = Array.from({ length: 40 }, () => ({ x: rand() * w, y: rand() * h, s: 20 + rand() * 60, c: [rand() * 255, rand() * 255, rand() * 255] }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = [90, 80, 70];
      for (const b of blocks) if (Math.abs(x - b.x) < b.s && Math.abs(y - b.y) < b.s / 2) c = b.c;
      if (Math.min(x, y, w - 1 - x, h - 1 - y) < w * 0.04) c = [20, 20, 22];
      data.set(c, (y * w + x) * 3);
    }
  }
  return { data, width: w, height: h, channels: 3 };
}

/** Regenbogen, der sich über die Karte zieht, plus feines Glitzern. */
function rainbow(u: number, v: number): number[] {
  const t = (u * 3 + v * 2) * Math.PI * 2 + (rand() - 0.5) * 1.5;
  return [Math.sin(t), Math.sin(t + 2.1), Math.sin(t + 4.2)].map((s) => 128 + 127 * s);
}

/**
 * Fotografiert die Karte leicht gedreht auf grauem Tisch, mit Kameraeffekten: Weißabgleich,
 * kräftigere Sättigung, Gammakurve, Rauschen. foil = Stärke des Regenbogenschimmers (0 = keiner).
 */
function photograph(card: Pixels, foil: number, angleDeg = 2) {
  const W = 420, H = 560;
  const ch = 440, cw = ch * (63 / 88);
  const cx = W / 2 + 4, cy = H / 2 - 3;
  const a = (angleDeg * Math.PI) / 180;
  const data = new Uint8ClampedArray(W * H * 3);
  const gain = [1.08, 1, 0.86];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = Math.cos(a) * dx + Math.sin(a) * dy + cw / 2;
      const v = -Math.sin(a) * dx + Math.cos(a) * dy + ch / 2;
      let c: number[];
      if (u < 0 || v < 0 || u >= cw || v >= ch) c = [110, 112, 115];
      else {
        const k = (Math.min(card.height - 1, Math.floor((v / ch) * card.height)) * card.width + Math.min(card.width - 1, Math.floor((u / cw) * card.width))) * 3;
        c = [card.data[k], card.data[k + 1], card.data[k + 2]];
        if (foil) {
          const r = rainbow(u / cw, v / ch);
          c = c.map((x, i) => x + foil * (r[i] - 128));
        }
        // Kamera: Sättigung, Gamma, Weißabgleich
        const l = (c[0] + c[1] + c[2]) / 3;
        c = c.map((x, i) => 255 * Math.pow(Math.max(0, Math.min(255, l + 1.25 * (x - l))) / 255, 0.9) * 0.85 * gain[i]);
      }
      data.set(c.map((x) => x + (rand() - 0.5) * 8), (y * W + x) * 3);
    }
  }
  const photo: Pixels = { data, width: W, height: H, channels: 3 };
  return { photo, expected: { x: cx - cw / 2 - 6, y: cy - ch / 2 + 5, width: cw, height: ch } };
}

describe('Foil-Erkennung', () => {
  const ref = makeReference();
  const shoot = (foil: number) => {
    const { photo, expected } = photograph(ref, foil);
    const quad = findCard(toGray(photo), expected);
    expect(quad).not.toBeNull();
    return estimateFoil(photo, quad!, ref);
  };

  it('hält eine normale Karte trotz Weißabgleich, Sättigung und Rauschen nicht für Foil', () => {
    const res = shoot(0);
    expect(res.foil).toBe(false);
  });

  it('erkennt Regenbogenschimmer als Foil', () => {
    const res = shoot(0.1);
    expect(res.foil).toBe(true);
    expect(res.score).toBeGreaterThan(0.3);
  });

  it('hält eine normale Karte mit Handyschatten nicht für Foil, Foil im Schatten aber schon', () => {
    const shadowed = (foil: number) => {
      const { photo, expected } = photograph(ref, foil);
      // Untere Hälfte im Schatten: 45 % Licht, weicher Übergang
      for (let y = 0; y < photo.height; y++) {
        const f = 1 - 0.55 * Math.min(1, Math.max(0, (y - 260) / 40));
        for (let x = 0; x < photo.width; x++) for (let i = 0; i < 3; i++) photo.data[(y * photo.width + x) * 3 + i] *= f;
      }
      return estimateFoil(photo, findCard(toGray(photo), expected)!, ref);
    };
    expect(shadowed(0).foil).toBe(false);
    expect(shadowed(0.1).foil).toBe(true);
  });

  it('macht ohne farbiges Original keine Aussage', () => {
    const gray: Pixels = { ...ref, data: ref.data.map((_, i) => ref.data[i - (i % 3)]) };
    const { photo, expected } = photograph(ref, 0);
    expect(estimateFoil(photo, findCard(toGray(photo), expected)!, gray).foil).toBeNull();
  });

  it('kennt Drucke, die es nur als Foil gibt', () => {
    const p = { finishes: ['foil'] } as Printing;
    expect(finishesOf(p)).toEqual(['foil']);
    expect(finishesOf({} as Printing)).toEqual(['normal', 'foil']);
  });

  it('lernt die Foil-Schwelle aus Bestätigungen und Korrekturen', () => {
    expect(learnFoilShare([])).toBe(FOIL_SHARE);
    // Echte Foils schimmern bei dir schwächer als gedacht: Schwelle sinkt zwischen normal und Foil
    const feedback = [
      { score: 0.02, foil: false },
      { score: 0.03, foil: false },
      { score: 0.07, foil: true },
      { score: 0.09, foil: true },
    ];
    const t = learnFoilShare(feedback);
    expect(t).toBeGreaterThan(0.03);
    expect(t).toBeLessThanOrEqual(0.07);
    // Normale Karten mit viel Spiegelung: Schwelle steigt
    expect(learnFoilShare([{ score: 0.2, foil: false }, { score: 0.5, foil: true }])).toBeGreaterThan(0.2);
    // Passt alles schon zur Standardschwelle, bleibt sie
    expect(learnFoilShare([{ score: 0.01, foil: false }, { score: 0.4, foil: true }])).toBe(FOIL_SHARE);
  });
});
