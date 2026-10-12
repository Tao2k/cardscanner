/// <reference lib="webworker" />
import { createEmbedder, type Embedder } from '../core/embedder';
import { loadCatalog } from '../core/catalog';
import { topK, type Match } from '../core/matcher';
import type { Pixels } from '../core/imageops';

/**
 * Erkennung im Hintergrund-Thread, damit die Kameravorschau flüssig bleibt.
 * Nachrichten: init → ready | error, match → result.
 */
export type WorkerRequest =
  | { type: 'init'; baseUrl: string; gameIds: string[] }
  | { type: 'match'; id: number; gameId: string; pixels: Pixels; k: number };

export type WorkerResponse =
  | { type: 'ready'; model: string }
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; matches: Match[]; ms: number };

let embedder: Embedder | null = null;
const catalogs = new Map<string, { embeddings: Float32Array; dim: number }>();

const post = (msg: WorkerResponse) => postMessage(msg);

onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      post({ type: 'progress', message: 'Lade Kartenkatalog …' });
      for (const gameId of msg.gameIds) {
        const catalog = await loadCatalog(msg.baseUrl, gameId);
        catalogs.set(gameId, { embeddings: catalog.embeddings, dim: catalog.meta.dim });
      }
      post({ type: 'progress', message: 'Lade Erkennungsmodell …' });
      embedder = await createEmbedder({ localModelPath: `${msg.baseUrl}models/` }).catch((e: Error) => {
        throw new Error(`Erkennungsmodell konnte nicht geladen werden (${e.message}). Bitte Internetverbindung prüfen und neu laden.`);
      });
      post({ type: 'ready', model: embedder.model });
    } else if (msg.type === 'match') {
      const catalog = catalogs.get(msg.gameId);
      if (!embedder || !catalog) throw new Error('Erkennung ist noch nicht bereit.');
      const start = performance.now();
      const vector = await embedder.embed(msg.pixels);
      const matches = topK(vector, catalog.embeddings, catalog.dim, msg.k);
      post({ type: 'result', id: msg.id, matches, ms: Math.round(performance.now() - start) });
    }
  } catch (e) {
    post({ type: 'error', message: (e as Error).message });
  }
};
