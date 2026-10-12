import type { Condition, Finish } from '../core/types';

/** Kleine Einstellungen pro Gerät. localStorage kann im privaten Modus fehlen, daher immer abgesichert. */
export interface Prefs {
  gameId: string;
  /** Drucksprache der gescannten Karten; 'auto' = per Texterkennung bestimmen. */
  language: string;
  finish: Finish;
  /** Zustand fest vorgeben bzw. Rückfallwert, wenn die Schätzung nicht klappt. */
  condition: Condition;
  /** Zustand aus dem Foto schätzen. */
  conditionAuto: boolean;
  location: string;
  lastExportAt: string | null;
}

const KEY = 'cardscanner.prefs';
const DEFAULTS: Prefs = { gameId: '', language: 'auto', finish: 'normal', condition: 'NM', conditionAuto: true, location: '', lastExportAt: null };

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ohne Speicher bleiben die Einstellungen nur bis zum Neuladen */
  }
}
