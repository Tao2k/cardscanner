export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Seitenverhältnis einer Standard-Spielkarte (63 × 88 mm). */
export const CARD_ASPECT = 63 / 88;

/** Zielrahmen für die Karte, mittig im sichtbaren Kamerabereich. */
export function guideRect(boxW: number, boxH: number, fill = 0.78): Rect {
  let height = boxH * fill;
  let width = height * CARD_ASPECT;
  if (width > boxW * 0.88) {
    width = boxW * 0.88;
    height = width / CARD_ASPECT;
  }
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

/**
 * Rechnet ein Rechteck aus Bildschirm-Koordinaten in Pixel des Kamerabilds um,
 * wenn das Video mit `object-fit: cover` in einer Box der Größe boxW × boxH angezeigt wird.
 */
export function boxToVideo(rect: Rect, videoW: number, videoH: number, boxW: number, boxH: number): Rect {
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const offsetX = (videoW * scale - boxW) / 2;
  const offsetY = (videoH * scale - boxH) / 2;
  return {
    x: (rect.x + offsetX) / scale,
    y: (rect.y + offsetY) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}
