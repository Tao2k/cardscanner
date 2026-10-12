import type { Match } from '../core/matcher';
import type { Pixels } from '../core/imageops';
import type { WorkerRequest, WorkerResponse } from './recognizer.worker';

/** Schmale Schnittstelle zum Erkennungs-Worker. */
export class Recognizer {
  private worker = new Worker(new URL('./recognizer.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, (r: { matches: Match[]; ms: number }) => void>();
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
          this.pending.forEach((cb) => cb({ matches: [], ms: 0 }));
          this.pending.clear();
        } else if (msg.type === 'result') {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
      };
    });
    this.post({ type: 'init', baseUrl, gameIds });
  }

  match(gameId: string, pixels: Pixels, k = 4): Promise<{ matches: Match[]; ms: number }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'match', id, gameId, pixels, k }, [pixels.data.buffer as ArrayBuffer]);
    });
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }
}
