import type { CollectionItem, Finish, Printing } from './types';

/**
 * Marktpreise je Druck, pro Spiel eine eigene Datei `data/<gameId>/prices.json`.
 * Sie wird getrennt vom Katalog gebaut, damit sich die Preise täglich erneuern lassen.
 * Preise gelten für Near Mint und unterscheiden nicht nach Sprache oder Zustand.
 */
export interface PriceEntry {
  /** Preis der normalen Ausführung. */
  n?: number;
  /** Preis der Foil-Ausführung. */
  f?: number;
  /** Produktseite beim Marktplatz. */
  url?: string;
}

export interface PriceFile {
  gameId: string;
  /** z. B. „Cardmarket“ */
  source: string;
  sourceUrl: string;
  currency: 'EUR';
  /** Stand der Preise laut Quelle (ISO-Zeit). */
  asOf: string;
  builtAt: string;
  prices: Record<string, PriceEntry>;
}

export async function loadPrices(baseUrl: string, gameId: string): Promise<PriceFile | null> {
  try {
    const res = await fetch(`${baseUrl}data/${gameId}/prices.json`, { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as PriceFile) : null;
  } catch {
    return null;
  }
}

/**
 * Preis eines Exemplars. Drucke, die es nur als Foil gibt (Riftbound Rare, Epic, Showcase), führt
 * Cardmarket als gewöhnliches Produkt; ihr Marktpreis steht deshalb im normalen Feld.
 */
export function priceFor(entry: PriceEntry | undefined, finish: Finish, printing?: Printing): number | undefined {
  if (!entry) return undefined;
  const onlyFoil = printing?.finishes?.length === 1 && printing.finishes[0] === 'foil';
  if (finish === 'foil') return onlyFoil ? (entry.n ?? entry.f) : entry.f;
  return entry.n;
}

export type PriceLookup = (gameId: string, printingId: string) => PriceEntry | undefined;

export function itemPrice(item: CollectionItem, prices: PriceLookup, printing?: Printing): number | undefined {
  return priceFor(prices(item.gameId, item.printingId), item.finish, printing);
}

/** Gesamtwert und wie viele Karten (Stückzahl) keinen Preis haben. */
export function collectionValue(items: CollectionItem[], prices: PriceLookup, lookup: (gameId: string, printingId: string) => Printing | undefined) {
  let total = 0;
  let unpriced = 0;
  for (const item of items) {
    const price = itemPrice(item, prices, lookup(item.gameId, item.printingId));
    if (price === undefined) unpriced += item.quantity;
    else total += price * item.quantity;
  }
  return { total: Math.round(total * 100) / 100, unpriced };
}

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export function formatEur(value: number): string {
  return EUR.format(value);
}

/** Datum des Preisstands, z. B. „21.10.2026“. */
export function formatAsOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}
