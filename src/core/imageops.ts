/** Einfache Pixel-Operationen, identisch im Browser und im Katalog-Build, damit Referenz- und Kamerabilder gleich vorverarbeitet werden. */

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  channels: 3 | 4;
}

/** Hintergrundfarbe für das Auffüllen auf ein Quadrat. */
const PAD_VALUE = 128;

/** Dreht ein Querformat-Bild um 90° im Uhrzeigersinn ins Hochformat; Hochformat bleibt unverändert. */
export function toPortrait(img: Pixels): Pixels {
  if (img.width <= img.height) return img;
  const { width: w, height: h, channels: c, data } = img;
  const out = new Uint8ClampedArray(w * h * c);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * c;
      // Ziel: neue Breite h, neue Höhe w; (x, y) → (h - 1 - y, x)
      const dst = (x * h + (h - 1 - y)) * c;
      for (let k = 0; k < c; k++) out[dst + k] = data[src + k];
    }
  }
  return { data: out, width: h, height: w, channels: c };
}

/**
 * Füllt das Bild mittig auf ein Quadrat auf (RGB, grauer Rand).
 * Das Bildmodell schneidet sonst die Mitte heraus und verliert Name und Rahmen der Karte.
 */
export function letterboxToSquare(img: Pixels): Pixels {
  const size = Math.max(img.width, img.height);
  const out = new Uint8ClampedArray(size * size * 3).fill(PAD_VALUE);
  const offX = Math.floor((size - img.width) / 2);
  const offY = Math.floor((size - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const src = (y * img.width + x) * img.channels;
      const dst = ((y + offY) * size + (x + offX)) * 3;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
    }
  }
  return { data: out, width: size, height: size, channels: 3 };
}
