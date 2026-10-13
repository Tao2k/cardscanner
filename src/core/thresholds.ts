/**
 * Schwellen aus deinen Rückmeldungen lernen (Foil, Sprache): Jede Rückmeldung ist ein Messwert und
 * ob er zur „oberen“ Klasse gehört (z. B. Foil, lateinischer Text). Gelernt wird die Schwelle, bei der
 * am wenigsten deiner Rückmeldungen falsch eingeordnet würden; bei Gleichstand die, die am nächsten an
 * der Standardschwelle liegt. Ohne Rückmeldungen bleibt es bei der Standardschwelle.
 */
export interface ThresholdFeedback {
  score: number;
  /** true = gehört zur Klasse ab der Schwelle (score ≥ Schwelle). */
  above: boolean;
}

export function learnThreshold(feedback: ThresholdFeedback[], fallback: number, min: number, max: number): number {
  if (!feedback.length) return fallback;
  const scores = [...new Set(feedback.map((f) => f.score))].sort((a, b) => a - b);
  const candidates = new Set([fallback, scores[0] * 0.8, scores[scores.length - 1] * 1.25]);
  for (let i = 1; i < scores.length; i++) candidates.add((scores[i - 1] + scores[i]) / 2);
  const errors = (t: number) => feedback.filter((f) => f.above !== f.score >= t).length;
  const distance = (t: number) => Math.abs(Math.log(Math.max(t, 1e-4) / fallback));
  let best = fallback;
  for (const t of candidates) {
    if (t <= 0) continue;
    const e = errors(t), b = errors(best);
    if (e < b || (e === b && distance(t) < distance(best))) best = t;
  }
  return Math.min(max, Math.max(min, best));
}
