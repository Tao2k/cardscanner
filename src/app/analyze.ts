import { estimateCondition, toGray, type ConditionEstimate } from '../core/condition';
import { estimateFoil, type FoilEstimate } from '../core/foil';
import type { Rect } from '../core/geometry';
import type { Pixels } from '../core/imageops';

/** Vergleichsbilder werden pro Sitzung nur einmal geladen. */
const cache = new Map<string, Promise<Pixels | null>>();

function loadReference(url: string): Promise<Pixels | null> {
  let g = cache.get(url);
  if (!g) {
    g = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        return { data, width: bitmap.width, height: bitmap.height, channels: 4 } as Pixels;
      })
      .catch(() => {
        cache.delete(url);
        return null;
      });
    cache.set(url, g);
  }
  return g;
}

export interface CardAnalysis {
  condition: ConditionEstimate;
  /** null, wenn die Karte im Foto nicht sicher genug gefunden wurde. */
  foil: FoilEstimate | null;
}

/**
 * Schätzt Zustand und Foil der Karte im Canvas. Hat der Druck mehrere Originale (z. B. englisch und
 * chinesisch), zählt das, zu dem das Foto am besten passt.
 */
export async function analyzeCanvas(ctx: CanvasRenderingContext2D, guide: Rect, references: string[], foilShare?: number): Promise<CardAnalysis> {
  const { width, height } = ctx.canvas;
  const pixels: Pixels = { data: ctx.getImageData(0, 0, width, height).data, width, height, channels: 4 };
  const photo = toGray(pixels);
  let best: ConditionEstimate = { condition: null, reason: 'Kein Vergleichsbild für diese Karte', edge: 0, corner: 0, fit: -1 };
  let bestRef: Pixels | null = null;
  for (const url of references) {
    const ref = await loadReference(url);
    if (!ref) continue;
    const est = estimateCondition(photo, guide, toGray(ref));
    if (est.fit > best.fit) [best, bestRef] = [est, ref];
  }
  // Foil nur, wenn die Karte gefunden wurde und zum Original passt (sonst wären die Farben verschoben)
  const foil = best.quad && bestRef && best.fit >= FOIL_MIN_FIT ? estimateFoil(pixels, best.quad, bestRef, foilShare) : null;
  return { condition: best, foil };
}

/** Mindestübereinstimmung (Korrelation) von Foto und Original für die Foil-Erkennung. */
const FOIL_MIN_FIT = 0.6;
