import { describe, expect, it } from 'vitest';
import { classify, estimateCondition, findCard, type Gray } from '../src/core/condition';

// Deterministischer Zufall
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Original im Kartenformat: dunkler Rahmen, darin ein Muster aus Flächen. */
function makeReference(w = 252, h = 352): Gray {
  const data = new Float32Array(w * h);
  const blocks = Array.from({ length: 40 }, () => ({ x: rand() * w, y: rand() * h, s: 20 + rand() * 60, v: 40 + rand() * 180 }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = Math.min(x, y, w - 1 - x, h - 1 - y) < w * 0.05;
      let v = 90;
      for (const b of blocks) if (Math.abs(x - b.x) < b.s && Math.abs(y - b.y) < b.s / 2) v = b.v;
      data[y * w + x] = border ? 35 : v;
    }
  }
  return { data, width: w, height: h };
}

/** Weiße Abnutzung direkt an der Kante: `specks` Flecken, Ecken stärker. */
function wear(ref: Gray, specks: number): Gray {
  const out = { ...ref, data: Float32Array.from(ref.data) };
  const { width: w, height: h } = ref;
  const paint = (cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h && Math.hypot(x - cx, y - cy) <= r) out.data[y * w + x] = 245;
    }
  };
  for (let i = 0; i < specks; i++) {
    const side = Math.floor(rand() * 4);
    const t = rand();
    const r = 1.5 + rand() * 2.5;
    if (side === 0) paint(t * w, 0, r);
    else if (side === 1) paint(w - 1, t * h, r);
    else if (side === 2) paint(t * w, h - 1, r);
    else paint(0, t * h, r);
  }
  return out;
}

/** Legt die Karte leicht gedreht auf einen Tisch der Helligkeit `table`. */
function photograph(card: Gray, table: number, angleDeg = 2): { photo: Gray; expected: { x: number; y: number; width: number; height: number } } {
  const W = 420, H = 560;
  const ch = 440, cw = ch * (63 / 88);
  const cx = W / 2 + 6, cy = H / 2 - 4;
  const a = (angleDeg * Math.PI) / 180;
  const data = new Float32Array(W * H);
  const r = 3 * (cw / 63);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // In Kartenkoordinaten zurückdrehen
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = Math.cos(a) * dx + Math.sin(a) * dy + cw / 2;
      const v = -Math.sin(a) * dx + Math.cos(a) * dy + ch / 2;
      const qx = Math.min(Math.max(u, r), cw - r), qy = Math.min(Math.max(v, r), ch - r);
      const inside = u >= 0 && v >= 0 && u < cw && v < ch && Math.hypot(u - qx, v - qy) <= r;
      const noise = (rand() - 0.5) * 6;
      if (!inside) data[y * W + x] = table + noise;
      else {
        const sx = Math.min(card.width - 1, Math.floor((u / cw) * card.width));
        const sy = Math.min(card.height - 1, Math.floor((v / ch) * card.height));
        // etwas dunkler und kontrastärmer als das Original, wie bei Kunstlicht
        data[y * W + x] = 0.8 * card.data[sy * card.width + sx] + 15 + noise;
      }
    }
  }
  return { photo: { data, width: W, height: H }, expected: { x: cx - cw / 2 - 8, y: cy - ch / 2 + 6, width: cw, height: ch } };
}

describe('Zustandsschätzung', () => {
  const ref = makeReference();

  it('findet die Kartenecken auf mittelgrauer Unterlage', () => {
    const { photo, expected } = photograph(ref, 90);
    const quad = findCard(photo, expected);
    expect(quad).not.toBeNull();
    // Ecke oben links der um 2° gedrehten Karte
    const a = (2 * Math.PI) / 180, cw = 440 * (63 / 88), ch = 440;
    const ex = 216 + Math.cos(a) * (-cw / 2) - Math.sin(a) * (-ch / 2);
    const ey = 276 + Math.sin(a) * (-cw / 2) + Math.cos(a) * (-ch / 2);
    expect(Math.abs(quad![0].x - ex)).toBeLessThan(2);
    expect(Math.abs(quad![0].y - ey)).toBeLessThan(2);
  });

  it('schätzt eine saubere Karte als NM und abgenutzte schlechter', () => {
    const shot = (card: Gray) => {
      const { photo, expected } = photograph(card, 90);
      return estimateCondition(photo, expected, ref);
    };
    expect(shot(ref).condition).toBe('NM');
    const light = shot(wear(ref, 12));
    const heavy = shot(wear(ref, 150));
    const rank = { NM: 0, LP: 1, MP: 2, HP: 3 } as const;
    expect(light.condition).not.toBeNull();
    expect(heavy.condition).not.toBeNull();
    expect(rank[light.condition!]).toBeGreaterThanOrEqual(1);
    expect(rank[heavy.condition!]).toBeGreaterThan(rank[light.condition!]);
    expect(heavy.edge).toBeGreaterThan(light.edge);
  });

  it('erkennt Karten auf dem Kopf', () => {
    const { photo, expected } = photograph(ref, 90, 182);
    expect(estimateCondition(photo, expected, ref).condition).toBe('NM');
  });

  it('schätzt lieber nicht, wenn sich dunkler Kartenrand kaum vom dunklen Tisch abhebt', () => {
    const { photo, expected } = photograph(ref, 25);
    expect(estimateCondition(photo, expected, ref).condition).toBeNull();
  });

  it('schätzt nicht auf hellem Tisch', () => {
    const { photo, expected } = photograph(ref, 225);
    const res = estimateCondition(photo, expected, ref);
    expect(res.condition).toBeNull();
    expect(res.reason).toBeTruthy();
  });

  it('schätzt nicht, wenn das Foto nicht zum Original passt', () => {
    const { photo, expected } = photograph(makeReference(), 90);
    expect(estimateCondition(photo, expected, ref).condition).toBeNull();
  });

  it('ordnet Messwerte den Stufen zu', () => {
    expect(classify(0, 0)).toBe('NM');
    expect(classify(0.01, 0.05)).toBe('LP');
    expect(classify(0.05, 0.2)).toBe('MP');
    expect(classify(0.2, 0.5)).toBe('HP');
  });
});
