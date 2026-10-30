import type { Pixels } from './imageops';

/**
 * Ausgleich ungleichmäßiger Beleuchtung, vor allem des Handyschattens auf der Karte.
 *
 * Ein Schatten macht eine Fläche der Karte gleichmäßig dunkler, die hellen Stellen darin also auch.
 * Je Rasterzelle wird deshalb die Helligkeit der hellen Pixel gemessen (90-%-Quantil); kleine dunkle
 * Stellen im Motiv werden über die Nachbarzellen geschlossen, damit sie nicht als Schatten gelten.
 * Das geglättete Ergebnis ist die geschätzte Beleuchtung; geteilt durch sie ist die Karte wieder
 * gleichmäßig hell. Der Ausgleich verändert auch das Motiv etwas (dunkle Flächen werden heller),
 * deshalb muss er bei Katalog und Kamerabild gleich angewendet werden.
 */

export interface LightField {
  cols: number;
  rows: number;
  /** Geschätzte Beleuchtung je Zelle (0–255), zeilenweise. */
  light: Float32Array;
}

export interface ShadingConfig {
  /** Rasterzellen über die kürzere Bildseite. */
  cells: number;
  /** Dunkle Stellen bis zu so vielen Zellen Radius gelten als Motiv, nicht als Schatten. */
  spread: number;
  /** Höchstens so stark aufhellen. */
  maxGain: number;
}

export const DEFAULT_SHADING: ShadingConfig = { cells: 8, spread: 2, maxGain: 3 };

const luma = (d: ArrayLike<number>, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

function quantile(values: ArrayLike<number>, q: number): number {
  const s = Float32Array.from(values).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
}

/** Beleuchtung je Rasterzelle (siehe oben). */
export function lightField(img: Pixels, config: ShadingConfig = DEFAULT_SHADING): LightField {
  const { width: w, height: h, channels: c, data } = img;
  const cell = Math.max(2, Math.round(Math.min(w, h) / config.cells));
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  const bright = new Float32Array(cols * rows);
  const hist = new Uint32Array(64);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows), y1 = Math.floor(((r + 1) * h) / rows);
    for (let q = 0; q < cols; q++) {
      const x0 = Math.floor((q * w) / cols), x1 = Math.floor(((q + 1) * w) / cols);
      hist.fill(0);
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) hist[Math.min(63, luma(data, (y * w + x) * c) >> 2)]++;
      // 90-%-Quantil: einzelne Spiegelpunkte zählen nicht
      let k = 0, seen = 0;
      while (k < 63 && seen + hist[k] < 0.9 * n) seen += hist[k++];
      bright[r * cols + q] = k * 4 + 2;
    }
  }
  const at = (a: Float32Array, q: number, r: number) => a[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, q))];
  // Erst Maximum, dann Minimum über die Nachbarn: Kleine dunkle Stellen im Motiv verschwinden, eine
  // große dunkle Fläche (Schatten) behält ihren Rand
  const filter = (src: Float32Array, pick: (a: number, b: number) => number) => {
    const out = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      let m = src[r * cols + q];
      for (let j = -config.spread; j <= config.spread; j++) for (let i = -config.spread; i <= config.spread; i++) m = pick(m, at(src, q + i, r + j));
      out[r * cols + q] = m;
    }
    return out;
  };
  // Zweimal 3 × 3 mitteln: weicher Übergang wie bei einem echten Schatten
  let light = filter(filter(bright, Math.max), Math.min);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(light, q + i, r + j);
      next[r * cols + q] = s / 9;
    }
    light = next;
  }
  return { cols, rows, light };
}

/**
 * Wie stark ist das Bild ungleichmäßig beleuchtet? 0 = gleichmäßig, 0,5 = der dunkelste Teil (10 %
 * der Fläche) bekommt nur halb so viel Licht wie der hellste.
 */
export function shadowStrength(field: LightField): number {
  const top = quantile(field.light, 0.9);
  return top > 0 ? Math.max(0, 1 - quantile(field.light, 0.1) / top) : 0;
}

/** Hellt dunkel beleuchtete Bereiche auf die Helligkeit der hell beleuchteten auf (RGB, neues Bild). */
export function evenLighting(img: Pixels, config: ShadingConfig = DEFAULT_SHADING, field = lightField(img, config)): Pixels {
  const { width: w, height: h, channels: c, data } = img;
  const { cols, rows, light } = field;
  const target = quantile(light, 0.9);
  const gain = new Float32Array(cols * rows);
  for (let i = 0; i < gain.length; i++) gain[i] = Math.min(config.maxGain, Math.max(1, target / Math.max(1, light[i])));
  const out = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    // Zellmitten bilinear verbinden
    const fy = Math.min(rows - 1, Math.max(0, ((y + 0.5) * rows) / h - 0.5));
    const r0 = Math.floor(fy), r1 = Math.min(rows - 1, r0 + 1), ty = fy - r0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(cols - 1, Math.max(0, ((x + 0.5) * cols) / w - 0.5));
      const q0 = Math.floor(fx), q1 = Math.min(cols - 1, q0 + 1), tx = fx - q0;
      const g =
        (gain[r0 * cols + q0] * (1 - tx) + gain[r0 * cols + q1] * tx) * (1 - ty) +
        (gain[r1 * cols + q0] * (1 - tx) + gain[r1 * cols + q1] * tx) * ty;
      const s = (y * w + x) * c, d = (y * w + x) * 3;
      out[d] = data[s] * g;
      out[d + 1] = data[s + 1] * g;
      out[d + 2] = data[s + 2] * g;
    }
  }
  return { data: out, width: w, height: h, channels: 3 };
}

/**
 * Gemessen mit `npm run eval -- --shadow 400` (synthetischer Handyschatten, Stärke mit DEFAULT_SHADING):
 * Karten ohne Schatten liegen zu 95 % unter 0,47 und zu 99 % unter 0,55, Karten mit Schatten im Median bei 0,44.
 * Ausgeglichen wird erst ab SHADOW_EVEN: So bleiben gleichmäßig beleuchtete Karten unverändert (dort brachte
 * der Ausgleich nichts), mit Schatten stieg Top-1 von 87,5 auf 88,8 %, automatisch gespeichert von 42,3 auf 44,5 %.
 */
export const SHADOW_EVEN = 0.45;
/** Ab dieser Stärke in jedem der letzten SHADOW_FRAMES Frames zeigt der Scanner einen Hinweis (ohne Schatten unter 1 %). */
export const SHADOW_HINT = 0.55;
export const SHADOW_FRAMES = 4;

/** Wie in der App vor der Erkennung: Schattenstärke messen und nur bei deutlichem Schatten ausgleichen. */
export function prepareForRecognition(img: Pixels): { pixels: Pixels; shadow: number } {
  const field = lightField(img);
  const shadow = shadowStrength(field);
  return { pixels: shadow >= SHADOW_EVEN ? evenLighting(img, DEFAULT_SHADING, field) : img, shadow };
}
