import type { Match } from './matcher';

export interface StabilizerConfig {
  /** So viele aufeinanderfolgende Frames muss derselbe Treffer vorne liegen. */
  requiredFrames: number;
  /** Unter diesem Wert gilt ein Frame als „keine Karte erkannt“. */
  minScore: number;
  /** Abstand Platz 1 zu Platz 2, ab dem ein Treffer ohne Prüfung als sicher gilt. */
  confidentMargin: number;
}

export const DEFAULT_STABILIZER: StabilizerConfig = {
  requiredFrames: 3,
  minScore: 0.55,
  confidentMargin: 0.04,
};

export interface StableResult {
  index: number;
  score: number;
  confident: boolean;
  alternatives: number[];
}

/**
 * Wandelt den Strom von Einzelframe-Treffern in einzelne Speicher-Ereignisse um:
 * Ein Treffer wird erst gemeldet, wenn er über mehrere Frames stabil ist, und
 * dieselbe Karte wird erst wieder gemeldet, nachdem sie das Bild verlassen hat.
 */
export class Stabilizer {
  private candidate = -1;
  private streak = 0;
  private lastEmitted = -1;

  constructor(private readonly config: StabilizerConfig = DEFAULT_STABILIZER) {}

  push(matches: Match[]): StableResult | null {
    const top = matches[0];
    if (!top || top.score < this.config.minScore) {
      this.candidate = -1;
      this.streak = 0;
      this.lastEmitted = -1;
      return null;
    }
    if (top.index === this.candidate) {
      this.streak++;
    } else {
      this.candidate = top.index;
      this.streak = 1;
    }
    if (this.streak < this.config.requiredFrames || top.index === this.lastEmitted) return null;

    this.lastEmitted = top.index;
    const second = matches[1]?.score ?? 0;
    return {
      index: top.index,
      score: top.score,
      confident: top.score - second >= this.config.confidentMargin,
      alternatives: matches.slice(1).map((m) => m.index),
    };
  }

  /** Erlaubt, dieselbe Karte sofort noch einmal zu erfassen (z. B. nach „Rückgängig“). */
  reset(): void {
    this.candidate = -1;
    this.streak = 0;
    this.lastEmitted = -1;
  }
}
