import type { Printing } from '../core/types';

const VARIANT_LABEL: Record<string, string> = {
  normal: '',
  alt_art: 'Alt Art',
  overnumbered: 'Overnumbered',
  signature: 'Signature',
  promo: 'Promo',
};

/** Anzeige immer mit englischem Namen; die Drucksprache steht nur als Merkmal am Eintrag. */
export function printingLabel(p: Printing): string {
  return `${p.cardName} (${printingCode(p)})`;
}

/** Set, Nummer und Variante, z. B. „OGN 042, Alt Art“. */
export function printingCode(p: Printing): string {
  const variant = VARIANT_LABEL[p.variant];
  return `${p.setCode} ${p.collectorNumber}${variant ? `, ${variant}` : ''}`;
}

export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Kartenbild in mehreren Breiten für srcset, damit es auf Retina-Displays scharf bleibt.
 * Nur für Bilder vom Bild-CDN, das die Breite über ?w= liefert; sonst undefined (dann gilt src).
 */
export function cardSrcSet(url: string, widths: number[]): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (!u.searchParams.has('w')) return undefined;
  return widths
    .map((w) => {
      u.searchParams.set('w', String(w));
      u.searchParams.set('fm', 'webp');
      return `${u} ${w}w`;
    })
    .join(', ');
}
