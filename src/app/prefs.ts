import type { Condition, Finish } from '../core/types';

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
export type PriceSort = 'value' | 'gain' | 'loss' | 'change' | 'number';

const KEY = 'cardscanner.prefs';
const DEFAULTS: Prefs = { gameId: '', language: 'auto', finish: 'normal', finishAuto: true, condition: 'NM', conditionAuto: true, torchAuto: true, lastExportAt: null, collectionSort: 'recent', newScans: 0, collectionOwnedOnly: false, collectionCollapsed: [], collectionView: 'binder', binderSet: '', binderNew: [], pricePeriod: 30, priceSort: 'value', priceCollapsed: [] };

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
