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

/** Sprachcode nach BCP 47, z. B. 'en', 'fr', 'zh-CN'. */
export type Language = string;

export interface LanguageInfo {
  code: Language;
  label: string;
}

export interface PrintingImage {
  imageUrl: string;
  thumbUrl?: string;
}

/**
 * Ein konkreter Druck einer Karte (Set + Sammlernummer + Variante).
 * Die Sprache gehört nicht zum Druck, sondern zum gesammelten Exemplar: Drucke in
 * verschiedenen Sprachen teilen sich Nummer und Artwork und unterscheiden sich nur im Text.
 */
export interface Printing {
  printingId: string;
  /** Englischer Name (Referenz für Suche und Export). */
  cardName: string;
  /** Lokalisierte Namen, z. B. { fr: '…', 'zh-CN': '…' }. */
  names?: Record<Language, string>;
  setCode: string;
  collectorNumber: string;
  variant: Variant;
  rarity?: string;
  type?: string;
  /**
   * Ausführungen, in denen es den Druck gibt. Nur 'foil' heißt: immer Foil (z. B. Riftbound Rare und Epic).
   * Fehlt die Angabe, ist beides möglich.
   */
  finishes?: Finish[];
  /** Englisches Kartenbild. */
  imageUrl: string;
  /** Kleines Vorschaubild für Listen; fehlt es, wird imageUrl verwendet. */
  thumbUrl?: string;
  /** Name und Regeltext je Sprache, für die Spracherkennung per OCR. */
  texts?: Record<Language, string>;
  /** Kartenbilder in anderen Sprachen, nur wo sie sich vom englischen unterscheiden. */
  images?: Record<Language, PrintingImage>;
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
  /** Anzahl Embedding-Zeilen (Referenzbilder), nicht Anzahl Drucke. */
  count: number;
  sets: CardSet[];
  /** Sprachen, in denen das Spiel gedruckt wird; die erste ist die Standardsprache. */
  languages: LanguageInfo[];
}

/** Embedding-Zeile → Druck (Index in printings) und Sprache des Referenzbilds. */
export interface ReferenceRow {
  p: number;
  lang: Language;
  /** Kleines Vergleichsbild (farbig, früher Graustufen) für Zustand und Foil, relativ zu data/<game>/ (fehlt bei alten Katalogen). */
  g?: string;
}

export interface Catalog {
  meta: CatalogMeta;
  printings: Printing[];
  /** Zuordnung der Embedding-Zeilen zu Drucken. */
  refs: ReferenceRow[];
  /** L2-normalisierte Embeddings, Länge count × dim. */
  embeddings: Float32Array;
  /** Graustufenraster je Referenzbild für den Pixelvergleich (fehlt bei alten Katalogen). */
  patches?: Float32Array[];
}

/** Zustandsstufen wie bei Cardmarket, von gut nach schlecht: Near Mint, Excellent, Good, Light Played, Played, Poor. */
export const CONDITIONS = ['NM', 'EX', 'GD', 'LP', 'PL', 'PO'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Frühere Stufen (NM, LP, MP, HP, DMG) auf die Cardmarket-Stufen. */
const LEGACY_CONDITIONS: Record<string, Condition> = { NM: 'NM', LP: 'EX', MP: 'GD', HP: 'PL', DMG: 'PO' };

/** Zustand aus gespeicherten Daten mit den früheren Stufen; Unbekanntes wird NM. */
export function conditionFromLegacy(value: string | null | undefined): Condition {
  return LEGACY_CONDITIONS[(value ?? '').toUpperCase()] ?? toCondition(value);
}

/** Zustand aus Text (z. B. Excel): Cardmarket-Kürzel bleiben, nur frühere Stufen (MP, HP, DMG) werden umgesetzt; Unbekanntes wird NM. */
export function toCondition(value: string | null | undefined): Condition {
  const v = (value ?? '').trim().toUpperCase();
  if ((CONDITIONS as readonly string[]).includes(v)) return v as Condition;
  return LEGACY_CONDITIONS[v] ?? 'NM';
}
export type Finish = 'normal' | 'foil';

export interface CollectionItem {
  itemId: string;
  gameId: GameId;
  printingId: string;
  language: Language;
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
