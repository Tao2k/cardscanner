import { estimateCondition, toGray, type ConditionEstimate, type Gray } from '../core/condition';
import type { Rect } from '../core/geometry';

/** Graustufen-Originale werden pro Sitzung nur einmal geladen. */
const cache = new Map<string, Promise<Gray | null>>();

function loadGray(url: string): Promise<Gray | null> {
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
        return toGray({ data, width: bitmap.width, height: bitmap.height, channels: 4 });
      })
      .catch(() => {
        cache.delete(url);
        return null;
      });
    cache.set(url, g);
  }
  return g;
}

/**
 * Schätzt den Zustand der Karte im Canvas. Hat der Druck mehrere Originale (z. B. englisch und
 * chinesisch), zählt das, zu dem das Foto am besten passt.
 */
export async function estimateFromCanvas(ctx: CanvasRenderingContext2D, guide: Rect, references: string[]): Promise<ConditionEstimate> {
  const { width, height } = ctx.canvas;
  const photo = toGray({ data: ctx.getImageData(0, 0, width, height).data, width, height, channels: 4 });
  let best: ConditionEstimate = { condition: null, reason: 'Kein Vergleichsbild für diese Karte', edge: 0, corner: 0, fit: -1 };
  for (const url of references) {
    const ref = await loadGray(url);
    if (!ref) continue;
    const est = estimateCondition(photo, guide, ref);
    if (est.fit > best.fit) best = est;
  }
  return best;
}
