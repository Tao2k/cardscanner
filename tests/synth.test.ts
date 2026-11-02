import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { augmentedViews } from '../scripts/synth';

/** Karte mit dunklem Rand und Muster, als PNG wie ein Referenzbild. */
async function cardPng(): Promise<Buffer> {
  const w = 252, h = 352;
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const border = x < 10 || y < 10 || x >= w - 10 || y >= h - 10;
    const v = border ? 15 : 128 + 100 * Math.sin(x / 11) * Math.cos(y / 17);
    data.set([v, 200 - v / 2, 255 - v], (y * w + x) * 3);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('Lernfotos für den Katalog', () => {
  it('sind je Karte gleich (gleicher Build, gleicher Katalog), aber je Karte anders', async () => {
    const card = await cardPng();
    const a = await augmentedViews(card, 2, 42);
    const b = await augmentedViews(card, 2, 42);
    expect(a).toHaveLength(2);
    expect(Buffer.compare(Buffer.from(a[0].data), Buffer.from(b[0].data))).toBe(0);
    const [other] = await augmentedViews(card, 1, 43);
    expect(Buffer.compare(Buffer.from(a[0].data), Buffer.from(other.data))).not.toBe(0);
    for (const view of a) expect(view.width / view.height).toBeCloseTo(63 / 88, 1);
  });
});
