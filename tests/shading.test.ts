import { describe, expect, it } from 'vitest';
import { evenLighting, lightField, shadowStrength } from '../src/core/shading';
import type { Pixels } from '../src/core/imageops';

/** Karte mit feinem Muster (hell/mittel im Wechsel), 230 × 320, RGB. */
function card(shade: (x: number, y: number) => number = () => 1): Pixels {
  const w = 230, h = 320;
  const data = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = ((x >> 2) + (y >> 2)) % 2 ? 220 : 120;
    const s = shade(x, y);
    data.set([v * s, v * 0.9 * s, v * 0.8 * s], (y * w + x) * 3);
  }
  return { data, width: w, height: h, channels: 3 };
}

/** Untere Hälfte im Schatten (40 % Licht), weicher Übergang. */
const shadow = (_x: number, y: number) => 1 - 0.6 * Math.min(1, Math.max(0, (y - 140) / 40));

const meanAbsDiff = (a: Pixels, b: Pixels) => {
  let s = 0;
  for (let i = 0; i < a.width * a.height; i++) s += Math.abs(a.data[i * a.channels] - b.data[i * b.channels]);
  return s / (a.width * a.height);
};

describe('Schattenausgleich', () => {
  it('erkennt einen Schatten über der Karte, aber nicht bei gleichmäßigem Licht', () => {
    expect(shadowStrength(lightField(card()))).toBeLessThan(0.05);
    expect(shadowStrength(lightField(card(shadow)))).toBeGreaterThan(0.45);
  });

  it('hellt den Schatten auf, ohne das gleichmäßig beleuchtete Bild zu verändern', () => {
    const clean = card();
    const evened = evenLighting(card(shadow));
    expect(meanAbsDiff(evenLighting(clean), clean)).toBeLessThan(2);
    expect(meanAbsDiff(card(shadow), clean)).toBeGreaterThan(35);
    expect(meanAbsDiff(evened, clean)).toBeLessThan(12);
  });

  it('nimmt RGBA aus dem Kamerabild und liefert RGB', () => {
    const rgba: Pixels = { data: new Uint8ClampedArray(40 * 60 * 4).fill(200), width: 40, height: 60, channels: 4 };
    const out = evenLighting(rgba);
    expect(out.channels).toBe(3);
    expect(out.data[0]).toBe(200);
  });
});
