import { describe, expect, it } from 'vitest';
import { AutoTorch, meanLuma } from '../src/core/light';

const gray = (v: number, width = 8, height = 8) => ({ data: new Uint8ClampedArray(width * height * 4).fill(v), width, height, channels: 4 as const });

describe('Kameralicht', () => {
  it('misst die mittlere Helligkeit', () => {
    expect(meanLuma(gray(0))).toBe(0);
    expect(meanLuma(gray(255))).toBeCloseTo(1);
    expect(meanLuma(gray(51), 1)).toBeCloseTo(0.2);
  });

  it('schaltet das Licht ein, wenn es länger zu dunkel ist', () => {
    const auto = new AutoTorch({ darkBelow: 0.22, window: 4, darkForMs: 1000, warmUpMs: 500 });
    auto.reset(0);
    const fired: number[] = [];
    for (let t = 0; t <= 3000; t += 250) if (auto.push(0.1, t)) fired.push(t);
    // Erst wenn 4 Frames da sind (750 ms) und es danach 1 s dunkel bleibt, und nur einmal
    expect(fired).toEqual([1750]);
    expect(auto.dark).toBe(true);
  });

  it('bleibt bei hellem Bild, kurzen Schatten oder während die Belichtung einregelt aus', () => {
    const auto = new AutoTorch({ darkBelow: 0.22, window: 4, darkForMs: 1000, warmUpMs: 500 });
    auto.reset(0);
    let fired = false;
    // Am Anfang dunkel (Belichtung regelt noch), dann hell mit kurzem Schatten (Hand im Bild)
    const lumas = [0.05, 0.05, 0.1, 0.4, 0.45, 0.5, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.05, 0.05, 0.05, 0.5, 0.5, 0.5];
    lumas.forEach((l, i) => (fired ||= auto.push(l, i * 250)));
    expect(fired).toBe(false);
    expect(auto.dark).toBe(false);
  });

  it('fängt nach einem neuen Scan wieder von vorn an', () => {
    const auto = new AutoTorch({ darkBelow: 0.22, window: 2, darkForMs: 0, warmUpMs: 0 });
    auto.reset(0);
    auto.push(0.1, 0);
    expect(auto.push(0.1, 10)).toBe(true);
    expect(auto.push(0.1, 20)).toBe(false);
    auto.reset(100);
    auto.push(0.1, 100);
    expect(auto.push(0.1, 110)).toBe(true);
  });
});
