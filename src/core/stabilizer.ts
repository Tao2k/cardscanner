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
   * Kalibriert mit `npm run bench` (siehe CALIBRATION): ab 0,06 waren 98,9 % richtig (untere
   * 95-%-Schranke), und das schon mit einem Frame; die App mittelt über mindestens drei. Darunter wird nachgefragt.
   */
  confidentMargin: number;
  /** So viele Kandidaten werden beim Nachfragen gezeigt. */
  candidates: number;
  /**
   * So lange (ms) muss eine erfasste Karte aus dem Bild sein, bevor sie erneut erfasst wird. Kurze
   * Aussetzer (Wackeln, Hand im Bild, Unschärfe) sollen nicht zu einem zweiten Scan derselben Karte führen.
   */
  clearAfterMs: number;
}

export const DEFAULT_STABILIZER: StabilizerConfig = {
  requiredFrames: 3,
  maxFrames: 10,
  minScore: 0.55,
  confidentMargin: 0.06,
  candidates: 4,
  clearAfterMs: 1200,
};

export interface StableResult {
  index: number;
  score: number;
  /** true = sicher, wird gespeichert; false = knapp, die App fragt nach. */
  confident: boolean;
  /** Geschätzte Wahrscheinlichkeit, dass der Treffer stimmt (0–1), aus CALIBRATION. */
  confidence: number;
  /** Weitere Kandidaten, beste zuerst. */
  alternatives: number[];
  /** Anzahl ausgewerteter Frames. */
  frames: number;
  /** Gemittelte Bildtreffer, beste zuerst (für den Abgleich mit dem Kartentext). */
  ranked: Match[];
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

/**
 * Wie oft ein Treffer mit diesem Abstand zum Zweitbesten richtig war: gemessen an 400 schweren
 * synthetischen Handyfotos (`npm run bench`, Oktober 2026: DINOv3-small, entzerrt, Pixelvergleich),
 * je ein Frame, Bereiche geglättet, damit größerer Abstand nie weniger Sicherheit bedeutet. Auf einem
 * leeren Tisch lag der Bestwert höchstens bei 0,46, richtige Treffer zu 95 % über 0,83 (minScore 0,55
 * passt also weiterhin). Echte Handyfotos können anders abschneiden; deshalb zählt die App zusätzlich
 * mit, wie oft du Treffer als falsch meldest (strictness).
 */
export const CALIBRATION: { margin: number; p: number }[] = [
  { margin: 0, p: 0.4 },
  { margin: 0.01, p: 0.45 },
  { margin: 0.015, p: 0.5 },
  { margin: 0.02, p: 0.75 },
  { margin: 0.03, p: 0.8 },
  { margin: 0.04, p: 0.88 },
  { margin: 0.05, p: 0.95 },
  { margin: 0.06, p: 0.98 },
  { margin: 0.08, p: 0.99 },
  { margin: 0.1, p: 0.995 },
];

/** Wahrscheinlichkeit richtig für einen Abstand (Stufen aus CALIBRATION). */
export function confidenceOf(margin: number): number {
  let p = CALIBRATION[0].p;
  for (const c of CALIBRATION) if (margin >= c.margin) p = c.p;
  return p;
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
  /** Schon gemeldete Karte (sie und ihre Kandidaten); solange einer davon vorne liegt, ist es noch dieselbe Karte. */
  private handled = new Set<number>();
  /** Seit wann keine Karte mehr im Bild ist (null = Karte im Bild). */
  private absentSince: number | null = null;
  /** true, solange die eben erfasste Karte noch im Bild liegt (für den Hinweis in der App). */
  holding = false;

  constructor(private readonly config: StabilizerConfig = DEFAULT_STABILIZER) {}

  /** Wie viele Frames für die aktuelle Karte schon gesammelt sind (für die Anzeige). */
  get collected(): number {
    return this.frames.length;
  }

  push(matches: Match[], now = Date.now()): StableResult | null {
    const top = matches[0];
    if (!top || top.score < this.config.minScore) {
      // Karte weg: erst nach einer Weile ohne Karte darf dieselbe wieder erfasst werden
      this.frames = [];
      this.absentSince ??= now;
      if (now - this.absentSince >= this.config.clearAfterMs) {
        this.handled.clear();
        this.holding = false;
      }
      return null;
    }
    this.absentSince = null;
    this.holding = this.handled.has(top.index);
    if (this.holding) return null;
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
      confidence: confidenceOf(avg[0].score - (avg[1]?.score ?? 0)),
      alternatives: shown.slice(1).map((m) => m.index),
      frames: this.frames.length,
      ranked: avg.slice(0, 8),
    };
    // Auch die Kandidaten zählen als „diese Karte“: springt die Erkennung zwischen Varianten, bleibt es ein Scan
    this.handled = new Set(shown.map((m) => m.index));
    this.holding = true;
    this.frames = [];
    return result;
  }

  /** Zusätzlich als erfasst merken (z. B. die gespeicherte Karte, wenn sie nicht unter den Kandidaten war). */
  markHandled(index: number): void {
    this.handled.add(index);
  }

  /** Erlaubt, dieselbe Karte sofort noch einmal zu erfassen (z. B. nach „Rückgängig“). */
  reset(): void {
    this.frames = [];
    this.handled.clear();
    this.absentSince = null;
    this.holding = false;
  }
}
