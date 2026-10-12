import { nameIn } from '../core/catalog';
import type { Language, Printing } from '../core/types';

const VARIANT_LABEL: Record<string, string> = {
  normal: '',
  alt_art: 'Alt Art',
  overnumbered: 'Overnumbered',
  signature: 'Signature',
  promo: 'Promo',
};

export function printingLabel(p: Printing, lang: Language = 'en'): string {
  const variant = VARIANT_LABEL[p.variant];
  return `${nameIn(p, lang)} (${p.setCode} ${p.collectorNumber}${variant ? `, ${variant}` : ''})`;
}

export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
