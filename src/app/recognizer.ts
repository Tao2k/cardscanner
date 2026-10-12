import type { Match } from '../core/matcher';
import type { Pixels } from '../core/imageops';
import type { WorkerRequest, WorkerResponse } from './recognizer.worker';

export interface MatchResult {
  matches: Match[];
  ms: number;
  /** Embedding des Kamerabilds; wird beim Speichern als eigener Scan zum Lernen abgelegt. */
  vector: Float32Array | null;
}

export interface Learned {
  userSamples: number;
  shiftSamples: number;
}

/** Schmale Schnittstelle zum Erkennungs-Worker. */
export class Recognizer {
  private worker = new Worker(new URL('./recognizer.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, (r: WorkerResponse) => void>();
  readonly ready: Promise<string>;

  constructor(baseUrl: string, gameIds: string[], onProgress: (message: string) => void) {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type === 'ready') resolve(msg.model);
        else if (msg.type === 'progress') onProgress(msg.message);
        else if (msg.type === 'error') {
          reject(new Error(msg.message));
          onProgress(`Fehler: ${msg.message}`);
          this.pending.forEach((cb) => cb(msg));
          this.pending.clear();
        } else {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
      };
    });
    this.post({ type: 'init', baseUrl, gameIds });
  }

  match(gameId: string, pixels: Pixels, k = 4): Promise<MatchResult> {
    return this.request((id) => ({ type: 'match', id, gameId, pixels, k }), [pixels.data.buffer as ArrayBuffer]).then((r) =>
      r.type === 'result' ? { matches: r.matches, ms: r.ms, vector: r.vector } : { matches: [], ms: 0, vector: null },
    );
  }

  /** Eigene Scans neu einlesen, nachdem du etwas bestätigt, korrigiert oder gelöscht hast. */
  reloadSamples(gameId: string): Promise<Learned> {
    return this.request((id) => ({ type: 'samples', id, gameId })).then((r) =>
      r.type === 'learned' ? { userSamples: r.userSamples, shiftSamples: r.shiftSamples } : { userSamples: 0, shiftSamples: 0 },
    );
  }

  private request(build: (id: number) => WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post(build(id), transfer);
    });
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }
}
