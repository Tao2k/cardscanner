import { describe, expect, it } from 'vitest';
import { fillGlare, glareMap, repairGlare } from '../src/core/glare';
import type { Pixels } from '../src/core/imageops';

const W = 120, H = 168;

/** Karte mit buntem, weichem Muster (ohne übersteuerte Stellen). */
function card(): Pixels {
  const data = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 120 + 70 * Math.sin(x / 11) * Math.cos(y / 15);
    data.set([v, 200 - v * 0.6, 90 + 0.4 * v], (y * W + x) * 3);
  }
  return { data, width: W, height: H, channels: 3 };
}

/** Runder Blitzfleck in der Mitte: Kern übersteuert, Rand weich. */
function withFlash(img: Pixels, radius = 18): Pixels {
  const data = Uint8ClampedArray.from(img.data);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - W / 2, y - H / 2) / radius;
    const a = Math.min(1, 1.8 * Math.exp(-d * d));
    for (let k = 0; k < 3; k++) data[(y * W + x) * 3 + k] += (255 - data[(y * W + x) * 3 + k]) * a;
  }
  return { data, width: W, height: H, channels: 3 };
}

const error = (a: Pixels, b: Pixels) => {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / a.data.length;
};

describe('glare', () => {
  it('lässt eine Karte ohne Spiegelung unverändert', () => {
    const img = card();
    const { pixels, glare } = repairGlare(img);
    expect(glare).toBe(0);
    expect(pixels).toBe(img);
  });

  it('findet den Blitzfleck und füllt ihn aus der Umgebung', () => {
    const clean = card();
    const flashed = withFlash(clean);
    const map = glareMap(flashed);
    expect(map.share).toBeGreaterThan(0.02);
    // Mitte ganz Spiegelung, Ecke Motiv
    expect(map.weight[(H / 2) * W + W / 2]).toBe(1);
    expect(map.weight[5 * W + 5]).toBe(0);
    const fixed = fillGlare(flashed, map);
    expect(error(fixed, clean)).toBeLessThan(error(flashed, clean) / 3);
    // Außerhalb des Flecks bleibt alles, wie es war
    const o = (10 * W + 10) * 3;
    expect([...fixed.data.subarray(o, o + 3)]).toEqual([...flashed.data.subarray(o, o + 3)]);
  });

  it('übersieht kleine weiße Stellen im Motiv', () => {
    const img = card();
    for (let y = 20; y < 24; y++) for (let x = 30; x < 50; x++) img.data.set([250, 250, 250], (y * W + x) * 3);
    expect(glareMap(img).share).toBe(0);
  });
});
