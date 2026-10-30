/// <reference lib="webworker" />
import { createEmbedder, type Embedder } from '../core/embedder';
import { loadCatalog } from '../core/catalog';
import { AdaptiveIndex } from '../core/learning';
import type { Match } from '../core/matcher';
import type { Pixels } from '../core/imageops';
import { IndexedDbSampleStore } from '../storage/indexeddb';
import { lightField, shadowStrength } from '../core/shading';

/**
 * Erkennung im Hintergrund-Thread, damit die Kameravorschau flüssig bleibt.
 * Nachrichten: init → ready | error, match → result, samples → learned.
 * Eigene Scans liest der Worker selbst aus IndexedDB, damit nicht tausende Vektoren hin- und hergeschickt werden.
 */
export type WorkerRequest =
  | { type: 'init'; baseUrl: string; gameIds: string[] }
  | { type: 'match'; id: number; gameId: string; pixels: Pixels; k: number }
  | { type: 'samples'; id: number; gameId: string };

export type WorkerResponse =
  | { type: 'ready'; model: string }
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; matches: Match[]; ms: number; vector: Float32Array; imageLanguages: { lang: string; score: number }[]; shadow: number }
  | { type: 'learned'; id: number; userSamples: number; shiftSamples: number };

let embedder: Embedder | null = null;
const indexes = new Map<string, { index: AdaptiveIndex; printingIndex: Map<string, number>; refLangs: string[] }>();
const samples = new IndexedDbSampleStore();

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => postMessage(msg, transfer);

async function loadSamples(gameId: string) {
  const entry = indexes.get(gameId);
  if (!entry) return { userSamples: 0, shiftSamples: 0 };
  const list = (await samples.list(gameId))
    .map((s) => ({ vector: s.vector, source: s.source, printing: entry.printingIndex.get(s.printingId) ?? -1 }))
    .filter((s) => s.printing >= 0);
  entry.index.setSamples(list);
  return { userSamples: entry.index.userSamples, shiftSamples: entry.index.shiftSamples };
}

onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      post({ type: 'progress', message: 'Lade Kartenkatalog …' });
      for (const gameId of msg.gameIds) {
        const catalog = await loadCatalog(msg.baseUrl, gameId);
        indexes.set(gameId, {
          index: new AdaptiveIndex(catalog.embeddings, Int32Array.from(catalog.refs, (r) => r.p), catalog.meta.dim),
          printingIndex: new Map(catalog.printings.map((p, i) => [p.printingId, i])),
          refLangs: catalog.refs.map((r) => r.lang),
        });
        await loadSamples(gameId).catch(() => undefined);
      }
      post({ type: 'progress', message: 'Lade Erkennungsmodell …' });
      embedder = await createEmbedder({ localModelPath: `${msg.baseUrl}models/` }).catch((e: Error) => {
        throw new Error(`Erkennungsmodell konnte nicht geladen werden (${e.message}). Bitte Internetverbindung prüfen und neu laden.`);
      });
      post({ type: 'ready', model: embedder.model });
    } else if (msg.type === 'match') {
      const entry = indexes.get(msg.gameId);
      if (!embedder || !entry) throw new Error('Erkennung ist noch nicht bereit.');
      const start = performance.now();
      const shadow = shadowStrength(lightField(msg.pixels));
      // Kopie, damit der Vektor nicht an einem größeren Puffer des Modells hängt
      const vector = Float32Array.from(await embedder.embed(msg.pixels));
      const matches = entry.index.search(vector, msg.k);
      // Wie ähnlich ist das Foto den Bildern der einzelnen Sprachfassungen des besten Treffers?
      const imageLanguages = matches[0]
        ? entry.index.rowScores(vector, matches[0].index).map((r) => ({ lang: entry.refLangs[r.row], score: r.score }))
        : [];
      post({ type: 'result', id: msg.id, matches, ms: Math.round(performance.now() - start), vector, imageLanguages, shadow }, [vector.buffer as ArrayBuffer]);
    } else if (msg.type === 'samples') {
      post({ type: 'learned', id: msg.id, ...(await loadSamples(msg.gameId)) });
    }
  } catch (e) {
    post({ type: 'error', message: (e as Error).message });
  }
};
