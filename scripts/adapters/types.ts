import type { CardSet, Printing } from '../../src/core/types';

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
  fetchCatalog(options?: { limit?: number }): Promise<{ sets: CardSet[]; printings: Printing[] }>;
}
