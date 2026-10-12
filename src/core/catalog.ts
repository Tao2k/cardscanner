import type { Catalog, CatalogMeta, Language, Printing, PrintingImage, ReferenceRow } from './types';

/**
 * Dateiformat eines gebauten Katalogs (pro Spiel ein Ordner unter `data/<gameId>/`):
 *   catalog.json    { meta, printings, refs }
 *   embeddings.f32  Float32 little-endian, count × dim, Zeile i ↔ printings[refs[i].p] in Sprache refs[i].lang
 * `data/games.json` listet alle verfügbaren Spiele.
 */
export interface CatalogFile {
  meta: CatalogMeta;
  printings: Printing[];
  refs: ReferenceRow[];
}

export interface GameEntry {
  gameId: string;
  gameName: string;
  count: number;
  builtAt: string;
}

export function parseEmbeddings(buffer: ArrayBuffer, meta: CatalogMeta): Float32Array {
  const embeddings = new Float32Array(buffer);
  if (embeddings.length !== meta.count * meta.dim) {
    throw new Error(`Embeddings passen nicht zum Katalog: ${embeddings.length} Werte, erwartet ${meta.count * meta.dim}`);
  }
  return embeddings;
}

export async function loadGames(baseUrl: string): Promise<GameEntry[]> {
  const res = await fetch(`${baseUrl}data/games.json`);
  if (!res.ok) throw new Error('Keine Kartenkataloge gefunden (data/games.json fehlt).');
  return res.json();
}

export async function loadCatalog(baseUrl: string, gameId: string): Promise<Catalog> {
  const [json, bin] = await Promise.all([
    fetch(`${baseUrl}data/${gameId}/catalog.json`).then((r) => {
      if (!r.ok) throw new Error(`Katalog ${gameId} nicht gefunden`);
      return r.json() as Promise<CatalogFile>;
    }),
    fetch(`${baseUrl}data/${gameId}/embeddings.f32`).then((r) => {
      if (!r.ok) throw new Error(`Embeddings für ${gameId} nicht gefunden`);
      return r.arrayBuffer();
    }),
  ]);
  return { meta: json.meta, printings: json.printings, refs: json.refs, embeddings: parseEmbeddings(bin, json.meta) };
}

/** Name eines Drucks in der gewünschten Sprache, sonst Englisch. */
export function nameIn(p: Printing, lang: Language): string {
  return p.names?.[lang] ?? p.cardName;
}

/** Kartenbild in der gewünschten Sprache, sonst das englische. */
export function imageIn(p: Printing, lang: Language): PrintingImage {
  return p.images?.[lang] ?? { imageUrl: p.imageUrl, thumbUrl: p.thumbUrl };
}
