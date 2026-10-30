import { findCard, resizeGray, squareToQuad, toGray } from './condition';
import type { Rect } from './geometry';
import type { Pixels } from './imageops';

/**
 * Was die Erkennung von der Karte sieht: entzerrt, wenn die Kanten gefunden werden, sonst der
 * Zielrahmen. Dazu ein kleines Graustufenraster für den Pixelvergleich mit den Originalen.
 * Katalog-Build und App nutzen dieselben Funktionen, damit beide Seiten gleich aussehen.
 */

/** Größe der entzerrten Karte (Höhe wie der bisherige Ausschnitt; das Modell rechnet ohnehin mit 224 px). */
export const VIEW_W = 229;
export const VIEW_H = 320;

/** Kamerabild mit Rand um den Zielrahmen (Anteil der Rahmenhöhe je Seite), damit die Kanten im Bild sind. */
export const VIEW_MARGIN = 0.1;

/** Entzerrt die Karte, wenn ihre vier Kanten nahe am Zielrahmen gefunden werden; sonst null. */
export function warpCardView(frame: Pixels, guide: Rect): Pixels | null {
  const quad = findCard(toGray(frame), guide);
  if (!quad) return null;
  const m = squareToQuad(quad);
  const out = new Uint8ClampedArray(VIEW_W * VIEW_H * 3);
  const { width: fw, height: fh, channels: c, data } = frame;
  for (let y = 0; y < VIEW_H; y++) {
    for (let x = 0; x < VIEW_W; x++) {
      const u = (x + 0.5) / VIEW_W;
      const v = (y + 0.5) / VIEW_H;
      const w = m[6] * u + m[7] * v + 1;
      const sx = Math.max(0, Math.min(fw - 1, (m[0] * u + m[1] * v + m[2]) / w - 0.5));
      const sy = Math.max(0, Math.min(fh - 1, (m[3] * u + m[4] * v + m[5]) / w - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, fw - 1), y1 = Math.min(y0 + 1, fh - 1);
      const fx = sx - x0, fy = sy - y0;
      for (let k = 0; k < 3; k++) {
        const top = data[(y0 * fw + x0) * c + k] * (1 - fx) + data[(y0 * fw + x1) * c + k] * fx;
        const bottom = data[(y1 * fw + x0) * c + k] * (1 - fx) + data[(y1 * fw + x1) * c + k] * fx;
        out[(y * VIEW_W + x) * 3 + k] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { data: out, width: VIEW_W, height: VIEW_H, channels: 3 };
}

/** Schneidet den Zielrahmen aus dem Kamerabild (Ersatz, wenn die Kanten nicht gefunden werden). */
export function cropGuide(frame: Pixels, guide: Rect): Pixels {
  const x0 = Math.max(0, Math.round(guide.x)), y0 = Math.max(0, Math.round(guide.y));
  const w = Math.min(frame.width - x0, Math.round(guide.width)), h = Math.min(frame.height - y0, Math.round(guide.height));
  const c = frame.channels;
  const out = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * frame.width + x + x0) * c;
      const d = (y * w + x) * 3;
      out[d] = frame.data[s];
      out[d + 1] = frame.data[s + 1];
      out[d + 2] = frame.data[s + 2];
    }
  }
  return { data: out, width: w, height: h, channels: 3 };
}

/** Pixelvergleich: Graustufenraster der Karte, ohne den äußeren Rand (dort liegen bei ungenauem Ausschnitt Tisch oder Kante). */
const PATCH_W = 32;
const PATCH_H = 44;
const PATCH_INSET = 3;
export const PATCH_DIM = (PATCH_W - 2 * PATCH_INSET) * (PATCH_H - 2 * PATCH_INSET);

/** Raster mittelwertfrei und auf Länge 1: das Skalarprodukt zweier Raster ist ihre Korrelation (Helligkeit und Kontrast egal). */
export function patchOf(img: Pixels): Float32Array {
  const small = resizeGray(toGray(img), PATCH_W, PATCH_H);
  const out = new Float32Array(PATCH_DIM);
  let i = 0;
  for (let y = PATCH_INSET; y < PATCH_H - PATCH_INSET; y++) for (let x = PATCH_INSET; x < PATCH_W - PATCH_INSET; x++) out[i++] = small.data[y * PATCH_W + x];
  return normalizePatch(out);
}

export function normalizePatch(v: Float32Array): Float32Array {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** Raster als Int8 (je Zeile auf den größten Betrag skaliert); 2 000 Referenzbilder ≈ 1,6 MB. */
export function quantizePatch(v: Float32Array): Int8Array {
  let max = 0;
  for (const x of v) max = Math.max(max, Math.abs(x));
  return Int8Array.from(v, (x) => Math.round((x / (max || 1)) * 127));
}

export function parsePatches(buffer: ArrayBuffer, count: number): Float32Array[] {
  const all = new Int8Array(buffer);
  if (all.length !== count * PATCH_DIM) throw new Error(`Vergleichsraster passen nicht zum Katalog: ${all.length} Werte, erwartet ${count * PATCH_DIM}`);
  return Array.from({ length: count }, (_, row) => normalizePatch(Float32Array.from(all.subarray(row * PATCH_DIM, (row + 1) * PATCH_DIM))));
}

export function correlation(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
