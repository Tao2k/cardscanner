import sharp from 'sharp';

/** Kleines farbiges Vergleichsbild (2 Pixel je mm) für Zustandsschätzung (Kanten) und Foil-Erkennung (Farben). */
export const COMPARE_SIZE = { width: 126, height: 176 };

export function compareReference(buf: Buffer) {
  return sharp(buf).flatten({ background: '#808080' }).resize(COMPARE_SIZE.width, COMPARE_SIZE.height, { fit: 'fill' });
}
