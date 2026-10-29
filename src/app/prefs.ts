import type { MoverSort } from '../core/priceHistory';
import { conditionFromLegacy, type Condition, type Finish } from '../core/types';

/** Kleine Einstellungen pro Gerät. localStorage kann im privaten Modus fehlen, daher immer abgesichert. */
export interface Prefs {
  gameId: string;
  /** Drucksprache der gescannten Karten; 'auto' = per Texterkennung bestimmen. */
  language: string;
  /** Ausführung fest vorgeben bzw. Rückfallwert, wenn die Erkennung nicht klappt. */
  finish: Finish;
  /** Foil aus Katalog und Foto bestimmen. */
  finishAuto: boolean;
  /** Zustand fest vorgeben bzw. Rückfallwert, wenn die Schätzung nicht klappt. */
  condition: Condition;
  /** Zustand aus dem Foto schätzen. */
  conditionAuto: boolean;
  /** 'cm' = condition ist schon ein Cardmarket-Kürzel; fehlt bei Einstellungen von vor der Umstellung. */
  conditionScale: 'cm';
  /** Kameralicht einschalten, wenn das Bild zu dunkel ist. */
  torchAuto: boolean;
  lastExportAt: string | null;
  /** Reihenfolge der Sammlung: zuletzt geändert, nach Set und Sammlernummer oder nach Preis. */
  collectionSort: CollectionSort;
  /** Seit dem letzten Öffnen der Sammlung gescannte Exemplare (Hinweis am Tab). */
  newScans: number;
  /** Sammlung: nur Karten zeigen, die man hat (sonst alle Karten des Katalogs). */
  collectionOwnedOnly: boolean;
  /** Eingeklappte Sets in der Sammlung, Schlüssel „gameId|setCode“. */
  collectionCollapsed: string[];
  /** Sammlung als Liste oder als Binder (ein Ordner je Set). */
  collectionView: CollectionViewMode;
  /** Zuletzt geöffneter Binder, Schlüssel „gameId|setCode“. */
  binderSet: string;
  /** Seit dem letzten Öffnen der Sammlung gescannte Drucke („gameId|printingId“, je Exemplar), fliegen dann in den Binder. */
  binderNew: string[];
  /** Zeitraum im Tab „Preise“ in Tagen; null = gesamter Verlauf. */
  pricePeriod: number | null;
  /** Reihenfolge der Karten im Tab „Preise“ (innerhalb eines Sets). */
  priceSort: PriceSort;
  /** Eingeklappte Sets im Tab „Preise“, Schlüssel „gameId|setCode“. */
  priceCollapsed: string[];
}

export type CollectionSort = 'recent' | 'set' | 'price';
export type CollectionViewMode = 'list' | 'binder';
export type PriceSort = MoverSort;

/** Zeiträume im Tab „Preise“ (Tage; null = gesamter Verlauf). */
export const PRICE_PERIODS: { days: number | null; label: string }[] = [
  { days: 7, label: '1 W' },
  { days: 30, label: '1 M' },
  { days: 183, label: '6 M' },
  { days: 365, label: '1 J' },
  { days: 1826, label: '5 J' },
  { days: null, label: 'Gesamt' },
];

const PRICE_SORTS: PriceSort[] = ['value-desc', 'value-asc', 'change-desc', 'change-asc', 'pct-desc', 'pct-asc'];
/** Frühere Sortierungen im Tab „Preise“ auf die heutigen abbilden. */
const OLD_PRICE_SORTS: Record<string, PriceSort> = { value: 'value-desc', gain: 'pct-desc', loss: 'pct-asc', change: 'change-desc', number: 'value-desc' };

const KEY = 'cardscanner.prefs';
const DEFAULTS: Prefs = { gameId: '', language: 'auto', finish: 'normal', finishAuto: true, condition: 'NM', conditionAuto: true, conditionScale: 'cm', torchAuto: true, lastExportAt: null, collectionSort: 'recent', newScans: 0, collectionOwnedOnly: false, collectionCollapsed: [], collectionView: 'binder', binderSet: '', binderNew: [], pricePeriod: 30, priceSort: 'value-desc', priceCollapsed: [] };

export function loadPrefs(): Prefs {
  try {
    return migratePrefs(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

/** Gespeicherte Einstellungen mit den Standardwerten ergänzen; veraltete Werte (frühere Zeiträume, Sortierungen, Zustandsstufen) umstellen. */
export function migratePrefs(stored: Partial<Prefs> | null): Prefs {
  const prefs: Prefs = { ...DEFAULTS, ...stored, conditionScale: 'cm' };
  if (stored?.condition && stored.conditionScale !== 'cm') prefs.condition = conditionFromLegacy(stored.condition);
  if (!PRICE_PERIODS.some((p) => p.days === prefs.pricePeriod)) prefs.pricePeriod = DEFAULTS.pricePeriod;
  if (!PRICE_SORTS.includes(prefs.priceSort)) prefs.priceSort = OLD_PRICE_SORTS[prefs.priceSort] ?? DEFAULTS.priceSort;
  return prefs;
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ohne Speicher bleiben die Einstellungen nur bis zum Neuladen */
  }
}
