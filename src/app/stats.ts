/**
 * Zählt mit, wie oft der Scanner selbst gespeichert hat und wie oft du so einen Treffer als falsch
 * gemeldet hast. Das ist die Genauigkeit an deinen echten Karten (pro Gerät).
 */
export interface ScanStats {
  /** Ohne Nachfrage gespeichert. */
  auto: number;
  /** Davon mit „Falsch“ gemeldet. */
  wrong: number;
  /** Nachgefragt, weil der Treffer knapp war. */
  asked: number;
}

const KEY = 'cardscanner.stats';

export function loadStats(): ScanStats {
  try {
    return { auto: 0, wrong: 0, asked: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { auto: 0, wrong: 0, asked: 0 };
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
  const pct = Math.floor((100 * (s.auto - s.wrong)) / s.auto);
  return `${pct} % richtig (${s.wrong} von ${s.auto} automatisch erkannten als falsch gemeldet)`;
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
