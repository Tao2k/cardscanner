import type { FoilFeedback } from '../core/foil';

/** Deine Foil-Rückmeldungen (pro Gerät), aus denen die Foil-Schwelle gelernt wird. */
const KEY = 'cardscanner.foil';
const MAX = 300;

export function loadFoilFeedback(): FoilFeedback[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((f) => typeof f?.score === 'number' && typeof f?.foil === 'boolean') : [];
  } catch {
    return [];
  }
}

/** Speichert eine Rückmeldung; eine spätere zum selben Scan (id) ersetzt die frühere. */
export function addFoilFeedback(id: string, entry: FoilFeedback): FoilFeedback[] {
  const next = [...loadFoilFeedback().filter((f) => (f as FoilFeedback & { id?: string }).id !== id), { ...entry, id }].slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ohne Speicher wird nur bis zum Neuladen gelernt */
  }
  return next;
}
