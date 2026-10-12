/**
 * Gemeinsames Datenmodell für alle Spiele.
 *
 * Katalog (was es gibt): Game → CardSet → Printing.
 * Sammlung (was eine Person besitzt): CollectionItem verweist immer auf einen konkreten Druck.
 * Spielspezifisches steht in `attributes` bzw. `externalIds`, damit ein neues TCG keine Schemaänderung braucht.
 */

export type GameId = string;

export interface CardSet {
  setId: string;
  code: string;
  name: string;
  releaseDate?: string;
}

export type Variant = 'normal' | 'alt_art' | 'overnumbered' | 'signature' | 'promo';

/** Ein konkreter Druck einer Karte (Set + Sammlernummer + Variante + Sprache). */
export interface Printing {
  printingId: string;
  cardName: string;
  setCode: string;
  collectorNumber: string;
  variant: Variant;
  language: string;
  rarity?: string;
  type?: string;
  imageUrl: string;
  attributes?: Record<string, unknown>;
  externalIds?: Record<string, string>;
}

export interface CatalogMeta {
  gameId: GameId;
  gameName: string;
  source: string;
  builtAt: string;
  model: string;
  dim: number;
  count: number;
  sets: CardSet[];
}

export interface Catalog {
  meta: CatalogMeta;
  printings: Printing[];
  /** L2-normalisierte Embeddings, Zeile i gehört zu printings[i]. Länge count × dim. */
  embeddings: Float32Array;
}

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
export type Finish = 'normal' | 'foil';

export interface CollectionItem {
  itemId: string;
  gameId: GameId;
  printingId: string;
  quantity: number;
  condition: Condition;
  finish: Finish;
  location: string;
  notes: string;
  /** false = automatisch erkannt, aber knapp; erscheint in der Prüfliste. */
  confirmed: boolean;
  /** Ähnlichkeit des Treffers (0–1), leer bei manueller Eingabe. */
  matchScore?: number;
  /** Nächstbeste Kandidaten zum schnellen Korrigieren. */
  alternatives?: string[];
  addedAt: string;
  updatedAt: string;
}
