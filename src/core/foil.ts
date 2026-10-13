import { squareToQuad, type Quad } from './condition';
import type { Pixels } from './imageops';
import type { Finish, Printing } from './types';

/**
 * Foil-Erkennung aus einem Kamerabild.
 *
 * Eine Foil-Karte schimmert in Regenbogenfarben, die im offiziellen Kartenbild fehlen und je nach
 * Stelle anders ausfallen. Das Foto wird deshalb entzerrt und mit dem farbigen Original verglichen:
 * Eine einzige Farbumrechnung für die ganze Karte gleicht Weißabgleich, Sättigung und Helligkeit der
 * Kamera aus. Was danach an Farbabweichung übrig bleibt, ist Schimmer. Spiegelungen auf Hüllen sind
 * meist weiß und zählen daher kaum mit.
 */

export interface FoilEstimate {
  /** null = keine Aussage möglich */
  foil: boolean | null;
  /** Anteil der Kartenfläche mit deutlicher Farbabweichung (0–1). */
  score: number;
}

/** Vergleichsraster: 1 Pixel je Millimeter, so stören kleine Ungenauigkeiten der Kanten kaum. */
const W = 63;
const H = 88;
/** Die äußeren 3 mm (abgerundete Ecken, Übergang zum Tisch) bleiben außen vor. */
const INSET = 3;
/** Farbabweichung (Anteil des Helligkeitsumfangs), ab der ein Pixel als schimmernd zählt. */
export const FOIL_PIXEL = 0.045;
/** Anteil schimmernder Pixel, ab dem die Karte als Foil gilt. */
export const FOIL_SHARE = 0.15;

type RGB = Float32Array;

/** Mittelt das Bild auf das W × H-Raster (Original im Kartenformat). */
function resizeRgb(img: Pixels): RGB {
  const out = new Float32Array(W * H * 3);
  const c = img.channels;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * img.height) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * img.width) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const k = (yy * img.width + xx) * c;
        r += img.data[k];
        g += img.data[k + 1];
        b += img.data[k + 2];
        n++;
      }
      out.set([r / n, g / n, b / n], (y * W + x) * 3);
    }
  }
  return out;
}

/** Entzerrt die Karte aus dem Foto auf das W × H-Raster (6 × 6 Abtastungen je Pixel). */
function warpRgb(img: Pixels, quad: Quad): RGB {
  const m = squareToQuad(quad);
  const out = new Float32Array(W * H * 3);
  const S = 6;
  const c = img.channels;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const u = (x + (i + 0.5) / S) / W;
          const v = (y + (j + 0.5) / S) / H;
          const w = m[6] * u + m[7] * v + 1;
          const px = Math.max(0, Math.min(img.width - 1, Math.round((m[0] * u + m[1] * v + m[2]) / w - 0.5)));
          const py = Math.max(0, Math.min(img.height - 1, Math.round((m[3] * u + m[4] * v + m[5]) / w - 0.5)));
          const k = (py * img.width + px) * c;
          r += img.data[k];
          g += img.data[k + 1];
          b += img.data[k + 2];
        }
      }
      out.set([r / (S * S), g / (S * S), b / (S * S)], (y * W + x) * 3);
    }
  }
  return out;
}

/**
 * Merkmale eines Originalpixels für die Farbumrechnung: Kanäle, ihre Quadrate (Gammakurve),
 * Mischterme (Sättigung, Farbstich je Farbton), Konstante.
 */
const N = 10;
function features(ref: RGB, i: number, f: Float64Array) {
  const r = ref[i * 3] / 255, g = ref[i * 3 + 1] / 255, b = ref[i * 3 + 2] / 255;
  f[0] = r; f[1] = g; f[2] = b; f[3] = r * r; f[4] = g * g; f[5] = b * b; f[6] = r * g; f[7] = g * b; f[8] = r * b; f[9] = 1;
}

/** Löst A·x = y (Gauß mit Pivotsuche); A ist n × n, zeilenweise. */
function solve(A: Float64Array, y: Float64Array, n: number): Float64Array {
  const a = Float64Array.from(A), v = Float64Array.from(y);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r * n + col]) > Math.abs(a[piv * n + col])) piv = r;
    for (let k = 0; k < n; k++) [a[col * n + k], a[piv * n + k]] = [a[piv * n + k], a[col * n + k]];
    [v[col], v[piv]] = [v[piv], v[col]];
    const d = a[col * n + col] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r * n + col] / d;
      if (!f) continue;
      for (let k = col; k < n; k++) a[r * n + k] -= f * a[col * n + k];
      v[r] -= f * v[col];
    }
  }
  return v.map((x, i) => x / (a[i * n + i] || 1e-9));
}

/** Farbabweichung des Fotos vom umgerechneten Original, je Pixel des Innenbereichs. */
export function chromaResidual(photo: RGB, ref: RGB): Float32Array {
  const inner: number[] = [];
  for (let y = INSET; y < H - INSET; y++) for (let x = INSET; x < W - INSET; x++) inner.push(y * W + x);

  // Kleinste Quadrate: je Fotokanal eine Kombination aus allen Originalkanälen (Weißabgleich, Sättigung, Gamma)
  const AtA = new Float64Array(N * N);
  const Aty = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  const f = new Float64Array(N);
  for (const i of inner) {
    features(ref, i, f);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) AtA[r * N + c] += f[r] * f[c];
      for (let ch = 0; ch < 3; ch++) Aty[ch][r] += f[r] * photo[i * 3 + ch];
    }
  }
  for (let r = 0; r < N; r++) AtA[r * N + r] += 1e-3 * inner.length;
  const coef = Aty.map((y) => solve(AtA, y, N));
  const predict = (i: number, out: number[]) => {
    features(ref, i, f);
    for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += coef[ch][k] * f[k];
      // Die Kamera schneidet zu helle oder zu dunkle Farben ab
      out[ch] = Math.max(0, Math.min(255, s));
    }
  };
  // Helligkeitsumfang des Fotos: Weiß minus Schwarz des Originals, umgerechnet
  const span = (c: Float64Array) => c.reduce((s, x, k) => (k < N - 1 ? s + x : s), 0);
  const range = Math.max(20, coef.reduce((s, c) => s + span(c), 0) / 3);

  // Je Pixel die kleinste Farbabweichung gegenüber einer Mischung aus dem Original an dieser Stelle und
  // einem der 8 Nachbarn: An Kanten im Motiv mischen sich zwei Farben, je nach Versatz unterschiedlich stark
  const out = new Float32Array(inner.length);
  const p0 = [0, 0, 0], pk = [0, 0, 0];
  const chroma = (v: number[]) => {
    const m = (v[0] + v[1] + v[2]) / 3;
    return [v[0] - m, v[1] - m, v[2] - m];
  };
  inner.forEach((i, n) => {
    const x = i % W, y = (i - x) / W;
    predict(i, p0);
    const a = chroma([photo[i * 3] - p0[0], photo[i * 3 + 1] - p0[1], photo[i * 3 + 2] - p0[2]]);
    let best = Math.hypot(a[0], a[1], a[2]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      predict((y + dy) * W + (x + dx), pk);
      const d = chroma([pk[0] - p0[0], pk[1] - p0[1], pk[2] - p0[2]]);
      const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const t = dd ? Math.max(0, Math.min(1, (a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) / dd)) : 0;
      const e = Math.hypot(a[0] - t * d[0], a[1] - t * d[1], a[2] - t * d[2]);
      if (e < best) best = e;
    }
    out[n] = best / range;
  });
  return out;
}

/**
 * Schätzt, ob die Karte im Foto Foil ist.
 * @param photo     Kamerabild (RGBA oder RGB)
 * @param quad      Kartenecken im Foto (aus der Zustandsschätzung, richtig herum)
 * @param reference farbiges Original im Kartenformat
 */
export function estimateFoil(photo: Pixels, quad: Quad, reference: Pixels): FoilEstimate {
  const residual = foilResidual(photo, quad, reference);
  if (!residual) return { foil: null, score: 0 };
  const score = shimmerShare(residual, FOIL_PIXEL);
  return { foil: score >= FOIL_SHARE, score };
}

/** Farbabweichung je Pixel; null, wenn das Original keine Farben hat (alter Katalog mit Graustufenbildern). */
export function foilResidual(photo: Pixels, quad: Quad, reference: Pixels): Float32Array | null {
  const ref = resizeRgb(reference);
  let colorful = 0;
  for (let i = 0; i < W * H; i++) colorful = Math.max(colorful, Math.max(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]) - Math.min(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]));
  if (colorful < 12) return null;
  return chromaResidual(warpRgb(photo, quad), ref);
}

/** Anteil der Pixel mit Farbabweichung über der Schwelle. */
export function shimmerShare(residual: Float32Array, pixelThreshold: number): number {
  let n = 0;
  for (const r of residual) if (r > pixelThreshold) n++;
  return n / residual.length;
}

/** Welche Ausführungen es von einem Druck gibt; ohne Angabe im Katalog beide. */
export function finishesOf(p: Printing): Finish[] {
  return p.finishes?.length ? p.finishes : ['normal', 'foil'];
}
