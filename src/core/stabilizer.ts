import type { Match } from './matcher';

export interface StabilizerConfig {
  /** Mindestens so viele Frames sammeln, bevor entschieden wird. */
  requiredFrames: number;
  /** Ist es nach so vielen Frames immer noch knapp, wird nachgefragt statt gespeichert. */
  maxFrames: number;
  /** Unter diesem Wert gilt ein Frame als „keine Karte erkannt“. */
  minScore: number;
  /**
   * Abstand Platz 1 zu Platz 2 (gemittelt über die Frames), ab dem ohne Nachfrage gespeichert wird.
   * Kalibriert mit `npm run eval`: darüber sind praktisch alle Treffer richtig.
   */
  confidentMargin: number;
  /** So viele Kandidaten werden beim Nachfragen gezeigt. */
  candidates: number;
}

export const DEFAULT_STABILIZER: StabilizerConfig = {
  requiredFrames: 3,
  maxFrames: 10,
  minScore: 0.55,
  confidentMargin: 0.04,
  candidates: 4,
};

export interface StableResult {
  index: number;
  score: number;
  /** true = sicher, wird gespeichert; false = knapp, die App fragt nach. */
  confident: boolean;
  /** Weitere Kandidaten, beste zuerst. */
  alternatives: number[];
  /** Anzahl ausgewerteter Frames. */
  frames: number;
}

/**
 * Mittelt die Treffer mehrerer Frames je Druck. Fehlt ein Druck in einem Frame, zählt dort der
 * schlechteste Wert dieses Frames (er lag also höchstens so gut).
 */
export function averageMatches(frames: Match[][]): Match[] {
  const sums = new Map<number, number>();
  for (const frame of frames) for (const m of frame) sums.set(m.index, 0);
  for (const frame of frames) {
    const floor = frame.length ? frame[frame.length - 1].score : 0;
    const seen = new Map(frame.map((m) => [m.index, m.score]));
    for (const index of sums.keys()) sums.set(index, sums.get(index)! + (seen.get(index) ?? floor));
  }
  return [...sums].map(([index, s]) => ({ index, score: s / frames.length })).sort((a, b) => b.score - a.score);
}

/** Sicher, wenn der gemittelte Abstand zum Zweiten groß genug ist. */
export function isConfident(avg: Match[], config: Pick<StabilizerConfig, 'minScore' | 'confidentMargin'>): boolean {
  return !!avg[0] && avg[0].score >= config.minScore && avg[0].score - (avg[1]?.score ?? 0) >= config.confidentMargin;
}

/**
 * Wandelt den Strom von Einzelframe-Treffern in einzelne Ereignisse um: Gesammelt wird über mehrere
 * Frames; ist der Treffer sicher, wird er gemeldet, sonst wird weitergesammelt und nach maxFrames
 * mit den besten Kandidaten nachgefragt. Dieselbe Karte wird erst wieder gemeldet, nachdem sie
 * das Bild verlassen hat.
 */
export class Stabilizer {
  private frames: Match[][] = [];
  /** Schon gemeldete Drucke; solange einer davon vorne liegt, ist es noch dieselbe Karte. */
  private handled = new Set<number>();

  constructor(private readonly config: StabilizerConfig = DEFAULT_STABILIZER) {}

  /** Wie viele Frames für die aktuelle Karte schon gesammelt sind (für die Anzeige). */
  get collected(): number {
    return this.frames.length;
  }

  push(matches: Match[]): StableResult | null {
    const top = matches[0];
    if (!top || top.score < this.config.minScore) {
      this.reset();
      return null;
    }
    if (this.handled.has(top.index)) return null;
    // Neue Karte: Liegt der Treffer nicht unter den bisherigen Favoriten, neu anfangen
    if (this.frames.length) {
      const leaders = averageMatches(this.frames).slice(0, this.config.candidates).map((m) => m.index);
      if (!leaders.includes(top.index)) this.frames = [];
    }
    this.frames.push(matches);
    if (this.frames.length < this.config.requiredFrames) return null;

    const avg = averageMatches(this.frames);
    const confident = isConfident(avg, this.config);
    if (!confident && this.frames.length < this.config.maxFrames) return null;

    const shown = avg.slice(0, this.config.candidates);
    const result: StableResult = {
      index: avg[0].index,
      score: avg[0].score,
      confident,
      alternatives: shown.slice(1).map((m) => m.index),
      frames: this.frames.length,
    };
    this.handled = new Set(confident ? [avg[0].index] : shown.map((m) => m.index));
    this.frames = [];
    return result;
  }

  /** Erlaubt, dieselbe Karte sofort noch einmal zu erfassen (z. B. nach „Rückgängig“). */
  reset(): void {
    this.frames = [];
    this.handled.clear();
  }
}
