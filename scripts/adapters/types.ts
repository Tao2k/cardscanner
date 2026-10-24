import type { PriceEntry } from '../../src/core/prices';
import type { CardSet, LanguageInfo, Printing } from '../../src/core/types';

/**
 * Anbindung eines Spiels an seine Kartendatenquelle. Für ein neues TCG wird nur ein
 * weiterer Adapter geschrieben und in `index.ts` registriert; Erkennung, App und
 * Excel-Export bleiben unverändert.
 */
export interface GameAdapter {
  gameId: string;
  gameName: string;
  /** Kurzbeschreibung der Datenquelle, erscheint in den Katalog-Metadaten. */
  source: string;
  /** Unterstützte Drucksprachen; die erste ist die Standardsprache. */
  languages: LanguageInfo[];
  fetchCatalog(options?: { limit?: number }): Promise<{ sets: CardSet[]; printings: Printing[] }>;
  /** Marktpreise je Druck (optional; ohne bleibt die Preisspalte leer). */
  fetchPrices?(printings: Printing[]): Promise<PriceResult>;
}

export interface PriceResult {
  source: string;
  sourceUrl: string;
  /** Stand der Preise laut Quelle (ISO-Zeit). */
  asOf: string;
  prices: Record<string, PriceEntry>;
  report: { printings: number; linked: number; priced: number; byName: number; rejected: string[] };
}
