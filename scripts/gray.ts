import sharp from 'sharp';

/** Kleines Graustufenbild (2 Pixel je mm) zum Vergleich der Kanten bei der Zustandsschätzung. */
export const GRAY_SIZE = { width: 126, height: 176 };

export function grayReference(buf: Buffer) {
  return sharp(buf).flatten({ background: '#808080' }).resize(GRAY_SIZE.width, GRAY_SIZE.height, { fit: 'fill' }).grayscale();
}
