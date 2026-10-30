import { parsePatches } from './cardview';
import type { Catalog, CatalogMeta, Language, Printing, PrintingImage, ReferenceRow } from './types';

/**
 * Dateiformat eines gebauten Katalogs (pro Spiel ein Ordner unter `data/<gameId>/`):
 *   catalog.json    { meta, printings, refs }
 *   embeddings.f32  Float32 little-endian, count × dim, Zeile i ↔ printings[refs[i].p] in Sprache refs[i].lang
 *   patches.i8      Int8, count × PATCH_DIM: Graustufenraster je Referenzbild für den Pixelvergleich (fehlt bei alten Katalogen)
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

/**
 * Lädt Katalog, Embeddings und Vergleichsraster. `model` hängt als Version an den Adressen: Nach einem
 * Modellwechsel holt der Service Worker die Dateien dann frisch statt alte Vektoren aus dem Cache zu nehmen.
 */
export async function loadCatalog(baseUrl: string, gameId: string, model?: string): Promise<Catalog> {
  const v = model ? `?v=${encodeURIComponent(model)}` : '';
  const [json, bin, patchBin] = await Promise.all([
    fetch(`${baseUrl}data/${gameId}/catalog.json${v}`).then((r) => {
      if (!r.ok) throw new Error(`Katalog ${gameId} nicht gefunden`);
      return r.json() as Promise<CatalogFile>;
    }),
    fetch(`${baseUrl}data/${gameId}/embeddings.f32${v}`).then((r) => {
      if (!r.ok) throw new Error(`Embeddings für ${gameId} nicht gefunden`);
      return r.arrayBuffer();
    }),
    fetch(`${baseUrl}data/${gameId}/patches.i8${v}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null),
  ]);
  if (model && json.meta.model !== model) {
    throw new Error(`Der Kartenkatalog passt nicht zum Erkennungsmodell (${json.meta.model} statt ${model}). Bitte die App in ein paar Minuten neu laden.`);
  }
  const patches = patchBin ? parsePatches(patchBin, json.meta.count) : undefined;
  return { meta: json.meta, printings: json.printings, refs: json.refs, embeddings: parseEmbeddings(bin, json.meta), patches };
}

/** Name eines Drucks in der gewünschten Sprache, sonst Englisch. */
export function nameIn(p: Printing, lang: Language): string {
  return p.names?.[lang] ?? p.cardName;
}

/** Kartenbild in der gewünschten Sprache, sonst das englische. */
export function imageIn(p: Printing, lang: Language): PrintingImage {
  return p.images?.[lang] ?? { imageUrl: p.imageUrl, thumbUrl: p.thumbUrl };
}
