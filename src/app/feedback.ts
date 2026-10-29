import type { FoilFeedback } from '../core/foil';
import type { ConditionFeedback } from '../core/condition';
import type { ThresholdFeedback } from '../core/thresholds';
import { conditionFromLegacy } from '../core/types';

/**
 * Deine Rückmeldungen je Fehlerart (pro Gerät, im Browser gespeichert), aus denen die Erkennung lernt.
 * Eine spätere Rückmeldung zum selben Scan (id) ersetzt die frühere.
 */
function store<T extends object>(key: string, valid: (x: unknown) => x is T, max = 300) {
  const load = (): T[] => {
    try {
      const list = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(list) ? list.filter(valid) : [];
    } catch {
      return [];
    }
  };
  const add = (id: string, entry: T): T[] => {
    const next = [...load().filter((f) => (f as T & { id?: string }).id !== id), { ...entry, id }].slice(-max);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ohne Speicher wird nur bis zum Neuladen gelernt */
    }
    return next;
  };
  return { load, add };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';

export const foilFeedback = store<FoilFeedback>('cardscanner.foil', (f): f is FoilFeedback => isObj(f) && typeof f.score === 'number' && typeof f.foil === 'boolean');

/** Sprache: wie gut der lateinisch gelesene Text zur englischen Karte passte, und ob es wirklich eine lateinische Sprache war. */
export const languageFeedback = store<ThresholdFeedback>('cardscanner.language', (f): f is ThresholdFeedback => isObj(f) && typeof f.score === 'number' && typeof f.above === 'boolean');

const CONDITION_KEY = 'cardscanner.condition.cm';

/** Zustandsangaben von vor der Umstellung auf die Cardmarket-Stufen einmalig übernehmen. */
try {
  const old = localStorage.getItem('cardscanner.condition');
  if (old !== null) {
    const list = JSON.parse(old);
    if (Array.isArray(list) && localStorage.getItem(CONDITION_KEY) === null) {
      localStorage.setItem(CONDITION_KEY, JSON.stringify(list.filter(isObj).map((f) => ({ ...f, condition: conditionFromLegacy(String(f.condition)) }))));
    }
    localStorage.removeItem('cardscanner.condition');
  }
} catch {
  /* ohne Speicher gibt es nichts zu übernehmen */
}

export const conditionFeedback = store<ConditionFeedback>(
  CONDITION_KEY,
  (f): f is ConditionFeedback => isObj(f) && typeof f.edge === 'number' && typeof f.corner === 'number' && typeof f.condition === 'string',
);
