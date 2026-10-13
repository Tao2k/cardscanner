/**
 * Zählt mit, wie oft der Scanner selbst gespeichert hat und wie oft du so einen Treffer als falsch
 * gemeldet hast. Das ist die Genauigkeit an deinen echten Karten (pro Gerät).
 */
export interface ScanStats {
  /** Ohne Nachfrage gespeichert. */
  auto: number;
  /** Davon mit „Falsch“ gemeldet. */
  wrong: number;
  /** Davon mit „Richtig“ bestätigt. */
  right: number;
  /** Davon Karte richtig, aber Foil/Normal falsch (von dir korrigiert). */
  foilWrong: number;
  /** Davon Karte richtig, aber Sprache falsch. */
  languageWrong: number;
  /** Davon Karte richtig, aber Zustand falsch. */
  conditionWrong: number;
  /** Nachgefragt, weil der Treffer knapp war. */
  asked: number;
}

const KEY = 'cardscanner.stats';
const EMPTY: ScanStats = { auto: 0, wrong: 0, right: 0, foilWrong: 0, languageWrong: 0, conditionWrong: 0, asked: 0 };

/** Deine Bewertung eines automatisch gespeicherten Scans: richtig, oder was falsch war. */
export type Judgement = 'right' | 'card' | 'foil' | 'language' | 'condition';
const FIELD: Record<Judgement, keyof ScanStats> = { right: 'right', card: 'wrong', foil: 'foilWrong', language: 'languageWrong', condition: 'conditionWrong' };

/**
 * Neue Bewertung eines Scans; jeder Scan zählt einmal. Ein Fehler ersetzt ein früheres „richtig“; eine
 * falsche Karte ersetzt einen früher gemeldeten kleineren Fehler (sie zählt für die Strenge des Scanners).
 * Liefert die neue Bewertung und die Änderung der Zähler (null = keine Änderung).
 */
export function judgeStats(previous: Judgement | undefined, next: Judgement): { judged: Judgement; patch: ((s: ScanStats) => Partial<ScanStats>) | null } {
  const replace = !previous || (previous === 'right' && next !== 'right') || (next === 'card' && previous !== 'card' && previous !== 'right');
  if (!replace) return { judged: previous!, patch: null };
  return {
    judged: next,
    patch: (s) => ({
      ...(previous ? { [FIELD[previous]]: s[FIELD[previous]] - 1 } : {}),
      [FIELD[next]]: s[FIELD[next]] + (previous && FIELD[previous] === FIELD[next] ? 0 : 1),
    }),
  };
}

export function loadStats(): ScanStats {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...EMPTY };
  }
}

export function updateStats(patch: (s: ScanStats) => Partial<ScanStats>): ScanStats {
  const current = loadStats();
  const next = { ...current, ...patch(current) };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ohne Speicher zählt es nur bis zum Neuladen nicht weiter */
  }
  return next;
}

/** z. B. „98 % richtig (2 von 120 als falsch gemeldet)“; null, solange zu wenig gezählt ist. */
export function accuracyText(s: ScanStats): string | null {
  if (s.auto < 1) return null;
  const wrong = s.wrong + s.foilWrong + s.languageWrong + s.conditionWrong;
  const pct = Math.floor((100 * (s.auto - wrong)) / s.auto);
  const kinds = [
    [s.wrong, 'Karte'],
    [s.foilWrong, 'Foil'],
    [s.languageWrong, 'Sprache'],
    [s.conditionWrong, 'Zustand'],
  ].filter(([n]) => n) as [number, string][];
  const detail = kinds.length && wrong ? `: ${kinds.map(([n, k]) => `${n}× ${k}`).join(', ')}` : '';
  return `${pct} % richtig (von ${s.auto} automatisch erkannten ${s.right} bestätigt, ${wrong} falsch${detail})`;
}

/**
 * Lernen aus deinen Meldungen: Meldest du mehr als 5 % der automatisch gespeicherten Treffer als
 * falsch (ab 20 Treffern), verlangt der Scanner mehr Abstand zum Zweitbesten und fragt öfter nach.
 * Je 2,5 Prozentpunkte über 5 % kommt 0,01 dazu, höchstens 0,06.
 */
export function strictness(s: ScanStats): number {
  if (s.auto < 20) return 0;
  const excess = s.wrong / s.auto - 0.05;
  return excess <= 0 ? 0 : Math.min(0.06, Math.ceil(excess / 0.025) * 0.01);
}
