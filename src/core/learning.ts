import { collapseToPrintings, l2normalize, topK, type Match } from './matcher';
import type { SampleStore } from '../storage/store';

/**
 * Lernen aus eigenen Scans, ohne das Modell neu zu trainieren:
 *
 * 1. Bestätigte oder korrigierte Scans werden zu zusätzlichen Referenzbildern. Wird dieselbe
 *    Karte wieder gescannt, passt sie zu deinem eigenen Foto besser als zum offiziellen Bild.
 * 2. Aus allen sicheren Scans ergibt sich, wie sich Kamera, Licht und Hülle im Mittel auf das
 *    Embedding auswirken. Diese Verschiebung wird vor der Suche abgezogen; das hilft auch bei
 *    Karten, die noch nie gescannt wurden.
 */

/**
 * pending: unsicherer Treffer, noch nicht bestätigt (wird nicht genutzt)
 * auto:    sicherer Treffer, nur für die Kamera-Verschiebung genutzt
 * user:    von dir bestätigt oder korrigiert, wird zusätzliches Referenzbild
 */
export type SampleSource = 'pending' | 'auto' | 'user';

export interface Sample {
  sampleId: string;
  gameId: string;
  printingId: string;
  /** Sammlungseintrag, zu dem der Scan gehört (für Bestätigen/Rückgängig). */
  itemId?: string;
  vector: Float32Array;
  source: SampleSource;
  createdAt: string;
}

export interface LearningConfig {
  /** Ab so vielen sicheren Scans wird die Kamera-Verschiebung angewendet. */
  minShiftSamples: number;
  /** Dämpfung: Verschiebung × n / (n + shrink), damit wenige Scans wenig bewirken. */
  shrink: number;
  /** Abzug für Treffer auf eigene Fotos, damit Foto-zu-Foto-Ähnlichkeit nicht überwiegt. */
  samplePenalty: number;
}

export const DEFAULT_LEARNING: LearningConfig = { minShiftSamples: 5, shrink: 20, samplePenalty: 0.02 };

/** Kopie von v minus shift, wieder auf Länge 1 gebracht. */
export function adapt(v: Float32Array, shift: Float32Array | null): Float32Array {
  const out = Float32Array.from(v);
  if (shift) for (let i = 0; i < out.length; i++) out[i] -= shift[i];
  return l2normalize(out);
}

/**
 * Suchindex aus Katalog-Embeddings plus eigenen Scans.
 * Treffer-Indizes zeigen wie beim Katalog auf Drucke.
 */
export class AdaptiveIndex {
  private shift: Float32Array | null = null;
  private sampleEmbeddings = new Float32Array(0);
  private samplePrintings: number[] = [];
  private rowsByPrinting = new Map<number, number[]>();
  /** Anzahl der Scans, aus denen die Verschiebung berechnet wurde. */
  shiftSamples = 0;

  constructor(
    private readonly embeddings: Float32Array,
    private readonly refs: ArrayLike<number>,
    private readonly dim: number,
    private readonly config: LearningConfig = DEFAULT_LEARNING,
  ) {
    for (let row = 0; row < refs.length; row++) {
      const list = this.rowsByPrinting.get(refs[row]) ?? [];
      list.push(row);
      this.rowsByPrinting.set(refs[row], list);
    }
  }

  get userSamples(): number {
    return this.samplePrintings.length;
  }

  /** Setzt die eigenen Scans (printing = Index des Drucks im Katalog). */
  setSamples(samples: { vector: Float32Array; printing: number; source: SampleSource }[]): void {
    const usable = samples.filter((s) => s.source !== 'pending' && s.vector.length === this.dim && this.rowsByPrinting.has(s.printing));

    // Mittlere Abweichung eigener Fotos vom jeweils ähnlichsten Referenzbild desselben Drucks
    this.shift = null;
    this.shiftSamples = usable.length;
    if (usable.length >= this.config.minShiftSamples) {
      const sum = new Float32Array(this.dim);
      for (const s of usable) {
        const v = adapt(s.vector, null);
        let best = -1;
        let bestScore = -Infinity;
        for (const row of this.rowsByPrinting.get(s.printing)!) {
          const score = this.dot(v, this.embeddings, row * this.dim);
          if (score > bestScore) [best, bestScore] = [row, score];
        }
        for (let i = 0; i < this.dim; i++) sum[i] += v[i] - this.embeddings[best * this.dim + i];
      }
      const factor = 1 / (usable.length + this.config.shrink);
      for (let i = 0; i < this.dim; i++) sum[i] *= factor;
      this.shift = sum;
    }

    const own = usable.filter((s) => s.source === 'user');
    this.sampleEmbeddings = new Float32Array(own.length * this.dim);
    own.forEach((s, i) => this.sampleEmbeddings.set(adapt(s.vector, this.shift), i * this.dim));
    this.samplePrintings = own.map((s) => s.printing);
  }

  search(query: Float32Array, k: number): Match[] {
    const q = adapt(query, this.shift);
    const fromCatalog = collapseToPrintings(topK(q, this.embeddings, this.dim, k * 3), (row) => this.refs[row], k);
    if (!this.samplePrintings.length) return fromCatalog;
    const fromSamples = collapseToPrintings(
      topK(q, this.sampleEmbeddings, this.dim, k * 3).map((m) => ({ index: m.index, score: m.score - this.config.samplePenalty })),
      (row) => this.samplePrintings[row],
      k,
    );
    const merged = [...fromCatalog, ...fromSamples].sort((a, b) => b.score - a.score);
    return collapseToPrintings(merged, (p) => p, k);
  }

  private dot(a: Float32Array, b: Float32Array, offset: number): number {
    let s = 0;
    for (let i = 0; i < this.dim; i++) s += a[i] * b[offset + i];
    return s;
  }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Was mit den eigenen Scans passiert, wenn du in der Sammlung bestätigst, korrigierst oder löschst. */
export class LearningService {
  constructor(private readonly store: SampleStore, private readonly now: () => Date = () => new Date()) {}

  /** Speichert den Scan; sichere Treffer helfen sofort bei der Kamera-Verschiebung. */
  async recordScan(input: { gameId: string; printingId: string; itemId: string; vector: Float32Array; confident: boolean }): Promise<Sample> {
    const sample: Sample = {
      sampleId: newId(),
      gameId: input.gameId,
      printingId: input.printingId,
      itemId: input.itemId,
      vector: input.vector,
      source: input.confident ? 'auto' : 'pending',
      createdAt: this.now().toISOString(),
    };
    await this.store.put(sample);
    return sample;
  }

  forget(sampleId: string): Promise<void> {
    return this.store.remove(sampleId);
  }

  /** Scan gehört jetzt zu einem anderen Eintrag (z. B. „Falsch erkannt“ → zum Prüfen). */
  async reassign(sample: Sample, itemId: string, source: SampleSource = 'pending'): Promise<void> {
    await this.store.put({ ...sample, itemId, source });
  }

  /** Du hast den Druck bestätigt oder korrigiert: alle Scans des Eintrags werden zu Referenzbildern. */
  async confirmItem(itemId: string, printingId: string): Promise<number> {
    const samples = await this.store.forItem(itemId);
    for (const s of samples) await this.store.put({ ...s, printingId, source: 'user' });
    return samples.length;
  }

  /** Eintrag gelöscht: unbestätigte Scans verwerfen, bestätigte behalten (die Karte bleibt ja richtig erkannt). */
  async itemRemoved(itemId: string): Promise<void> {
    for (const s of await this.store.forItem(itemId)) if (s.source !== 'user') await this.store.remove(s.sampleId);
  }

  async counts(gameId: string): Promise<{ user: number; auto: number }> {
    const all = await this.store.list(gameId);
    return { user: all.filter((s) => s.source === 'user').length, auto: all.filter((s) => s.source === 'auto').length };
  }

  reset(gameId: string): Promise<void> {
    return this.store.clear(gameId);
  }
}
