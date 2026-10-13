import type { FoilFeedback } from '../core/foil';
import type { ConditionFeedback } from '../core/condition';
import type { ThresholdFeedback } from '../core/thresholds';

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

export const conditionFeedback = store<ConditionFeedback>(
  'cardscanner.condition',
  (f): f is ConditionFeedback => isObj(f) && typeof f.edge === 'number' && typeof f.corner === 'number' && typeof f.condition === 'string',
);
