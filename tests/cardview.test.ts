import { describe, expect, it } from 'vitest';
import { correlation, cropGuide, parsePatches, patchOf, PATCH_DIM, quantizePatch, VIEW_H, VIEW_W, warpCardView } from '../src/core/cardview';
import type { Pixels } from '../src/core/imageops';

/** Karte mit schwarzem Rand und einem Muster innen, leicht gedreht auf grauem Tisch. */
function scene(angleDeg: number): { frame: Pixels; card: Pixels; guide: { x: number; y: number; width: number; height: number } } {
  const cw = 126, ch = 176;
  const card = new Uint8ClampedArray(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const border = x < 6 || y < 6 || x >= cw - 6 || y >= ch - 6;
      const v = border ? 10 : 128 + 100 * Math.sin(x / 9) * Math.cos(y / 13) + (y > ch / 2 ? 20 : -20);
      card.set([v, v * 0.8, 255 - v], (y * cw + x) * 3);
    }
  }
  const W = 260, H = 300;
  const frame = new Uint8ClampedArray(W * H * 3).fill(170);
  const a = (angleDeg * Math.PI) / 180;
  const scale = 1.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2, dy = y - H / 2;
      const u = (Math.cos(a) * dx + Math.sin(a) * dy) / scale + cw / 2;
      const v = (-Math.sin(a) * dx + Math.cos(a) * dy) / scale + ch / 2;
      if (u >= 0 && v >= 0 && u < cw && v < ch) {
        const s = (Math.floor(v) * cw + Math.floor(u)) * 3;
        frame.set(card.subarray(s, s + 3), (y * W + x) * 3);
      }
    }
  }
  const gw = cw * scale, gh = ch * scale;
  return { frame: { data: frame, width: W, height: H, channels: 3 }, card: { data: card, width: cw, height: ch, channels: 3 }, guide: { x: (W - gw) / 2, y: (H - gh) / 2, width: gw, height: gh } };
}

describe('cardview', () => {
  it('entzerrt eine leicht gedrehte Karte, sodass sie zum Original passt', () => {
    const { frame, card, guide } = scene(2.5);
    const warped = warpCardView(frame, guide);
    expect(warped).not.toBeNull();
    expect([warped!.width, warped!.height]).toEqual([VIEW_W, VIEW_H]);
    const fit = correlation(patchOf(warped!), patchOf(card));
    expect(fit).toBeGreaterThan(0.9);
    // Ohne Entzerren (nur Zielrahmen) passt es schlechter
    expect(correlation(patchOf(cropGuide(frame, guide)), patchOf(card))).toBeLessThan(fit);
  });

  it('findet keine Karte auf leerem Tisch', () => {
    const frame: Pixels = { data: new Uint8ClampedArray(200 * 260 * 3).fill(120), width: 200, height: 260, channels: 3 };
    expect(warpCardView(frame, { x: 20, y: 20, width: 160, height: 220 })).toBeNull();
  });

  it('Raster überstehen das Speichern als Int8', () => {
    const { card } = scene(0);
    const p = patchOf(card);
    expect(p.length).toBe(PATCH_DIM);
    const q = quantizePatch(p);
    const [back] = parsePatches(q.buffer as ArrayBuffer, 1);
    expect(correlation(p, back)).toBeGreaterThan(0.999);
  });
});
