import { priceFor, type PriceFile, type PriceLookup } from './prices';
import type { CollectionItem, Finish, Printing } from './types';

/**
 * Preisverlauf je Druck. Cardmarket liefert nur den Preis von heute, daher hängt der tägliche Build
 * jeden Preisstand an diese Datei an (`data/<gameId>/price-history.json`, dauerhaft gespeichert im
 * Zweig `price-history`). Preise in Cent, je Druck eine Reihe gleich lang wie `dates`, null = kein Preis.
 */
export interface PriceHistoryFile {
  gameId: string;
  currency: 'EUR';
  source: string;
  /** Tage der Preisstände (YYYY-MM-DD, Zeitzone Berlin), aufsteigend. */
  dates: string[];
  /** Normale Ausführung. */
  n: Record<string, (number | null)[]>;
  /** Foil-Ausführung. */
  f: Record<string, (number | null)[]>;
}

/** Tage mit täglichem Preisstand; ältere Tage werden auf einen pro Woche ausgedünnt, damit die Datei klein bleibt. */
export const DAILY_DAYS = 90;

/** „Stark“ gestiegen oder gefallen: mindestens 20 % und 0,10 € je Karte, oder 10 € je Karte unabhängig vom Anteil. */
export const STRONG_PCT = 0.2;
export const STRONG_MIN_EUR = 0.1;
export const STRONG_EUR = 10;

/** Kalendertag in Berlin, z. B. „2026-10-25“. */
export function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/** Montag der Woche als Schlüssel (1970-01-01 war ein Donnerstag). */
function weekOf(day: string): number {
  return Math.floor((dayNumber(day) + 3) / 7);
}

const cents = (v: number | undefined) => (v === undefined ? null : Math.round(v * 100));

/** Hängt den Preisstand an (gleicher Tag wird ersetzt) und dünnt alte Tage aus. */
export function appendSnapshot(history: PriceHistoryFile | null, prices: PriceFile): PriceHistoryFile {
  const day = dayOf(prices.asOf);
  const h: PriceHistoryFile = history
    ? { ...history, dates: [...history.dates], n: { ...history.n }, f: { ...history.f } }
    : { gameId: prices.gameId, currency: 'EUR', source: prices.source, dates: [], n: {}, f: {} };
  for (const key of ['n', 'f'] as const) for (const id of Object.keys(h[key])) h[key][id] = [...h[key][id]];

  let at = h.dates.indexOf(day);
  if (at < 0) {
    at = h.dates.findIndex((d) => d > day);
    if (at < 0) at = h.dates.length;
    h.dates.splice(at, 0, day);
    for (const key of ['n', 'f'] as const) for (const series of Object.values(h[key])) series.splice(at, 0, null);
  }
  for (const key of ['n', 'f'] as const) {
    for (const series of Object.values(h[key])) series[at] = null;
    for (const [id, entry] of Object.entries(prices.prices)) {
      const value = cents(entry[key]);
      if (value === null) continue;
      (h[key][id] ??= Array<number | null>(h.dates.length).fill(null))[at] = value;
    }
  }
  return thin(h);
}

function thin(h: PriceHistoryFile): PriceHistoryFile {
  const newest = dayNumber(h.dates[h.dates.length - 1] ?? '1970-01-01');
  const seenWeeks = new Set<number>();
  const keep = h.dates.map((d) => {
    if (newest - dayNumber(d) < DAILY_DAYS) return true;
    const week = weekOf(d);
    if (seenWeeks.has(week)) return false;
    seenWeeks.add(week);
    return true;
  });
  const pick = <T>(list: T[]) => list.filter((_, i) => keep[i]);
  const out: PriceHistoryFile = { ...h, dates: pick(h.dates), n: {}, f: {} };
  for (const key of ['n', 'f'] as const) {
    for (const [id, series] of Object.entries(h[key])) {
      const kept = pick(series);
      if (kept.some((v) => v !== null)) out[key][id] = kept;
    }
  }
  return out;
}

export async function loadPriceHistory(baseUrl: string, gameId: string): Promise<PriceHistoryFile | null> {
  try {
    const res = await fetch(`${baseUrl}data/${gameId}/price-history.json`, { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as PriceHistoryFile) : null;
  } catch {
    return null;
  }
}

/**
 * Lückenlose Reihe in Euro: vor dem ersten Preis gilt der erste Preis, Lücken übernehmen den letzten.
 * So erscheint eine Karte, die erst später einen Preis bekommt, nicht als Preissprung.
 */
function filled(series: (number | null)[] | undefined, length: number): (number | undefined)[] {
  const out = Array<number | undefined>(length).fill(undefined);
  if (!series) return out;
  const first = series.find((v) => v !== null);
  if (first == null) return out;
  let last = first;
  for (let i = 0; i < length; i++) {
    const v = series[i];
    if (v != null) last = v;
    out[i] = last / 100;
  }
  return out;
}

/** Preisreihe eines Exemplars (je Tag in `history.dates`), nach denselben Regeln wie priceFor. */
export function itemSeries(history: PriceHistoryFile, item: Pick<CollectionItem, 'printingId' | 'finish'>, printing?: Printing): (number | undefined)[] {
  const n = filled(history.n[item.printingId], history.dates.length);
  const f = filled(history.f[item.printingId], history.dates.length);
  return history.dates.map((_, i) => priceFor({ n: n[i], f: f[i] }, item.finish, printing));
}

export interface ValuePoint {
  date: string;
  value: number;
}

/**
 * Wert der heutigen Sammlung an jedem Tag des Verlaufs. Mehrere Spiele werden über alle Tage
 * zusammengelegt; ein Spiel ohne Preisstand an einem Tag zählt mit seinem letzten Stand.
 */
export function collectionSeries(
  items: CollectionItem[],
  histories: Map<string, PriceHistoryFile>,
  lookup: (gameId: string, printingId: string) => Printing | undefined,
): ValuePoint[] {
  const dates = [...new Set([...histories.values()].flatMap((h) => h.dates))].sort();
  const totals = dates.map(() => 0);
  for (const [gameId, h] of histories) {
    const perDay = h.dates.map(() => 0);
    for (const item of items) {
      if (item.gameId !== gameId) continue;
      itemSeries(h, item, lookup(gameId, item.printingId)).forEach((v, i) => {
        if (v !== undefined) perDay[i] += v * item.quantity;
      });
    }
    let j = 0;
    dates.forEach((d, i) => {
      while (j + 1 < h.dates.length && h.dates[j + 1] <= d) j++;
      if (h.dates.length) totals[i] += perDay[j];
    });
  }
  return dates.map((date, i) => ({ date, value: Math.round(totals[i] * 100) / 100 }));
}

/** Tag `days` Tage vor `day`, z. B. shiftDay('2026-10-26', -30). */
export function shiftDay(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** Index des Vergleichstags: letzter Tag, der mindestens `days` vor dem neuesten liegt, sonst der erste. */
export function startIndex(dates: string[], days: number | null): number {
  if (!dates.length || days === null) return 0;
  const target = dayNumber(dates[dates.length - 1]) - days;
  let at = 0;
  dates.forEach((d, i) => {
    if (dayNumber(d) <= target) at = i;
  });
  return at;
}

/**
 * Woran die Entwicklung gemessen wird: am eigenen Verlauf, sobald er den Zeitraum abdeckt (bei 1 Jahr und
 * „Alles“ reichen 30 Tage), sonst an Cardmarkets Durchschnittspreis der letzten 7 bzw. 30 Tage.
 */
export type Basis = { kind: 'history'; since: string } | { kind: 'average'; days: 7 | 30 };

export function basisFor(history: PriceHistoryFile | undefined, days: number | null): Basis {
  const dates = history?.dates ?? [];
  if (dates.length > 1) {
    const span = dayNumber(dates[dates.length - 1]) - dayNumber(dates[0]);
    if (span >= Math.min(days ?? Infinity, 30)) return { kind: 'history', since: dates[startIndex(dates, days)] };
  }
  return { kind: 'average', days: days === 7 ? 7 : 30 };
}

/** Punkt im Wertverlauf; `average` = Wert zu Cardmarkets Durchschnitt der letzten 7 bzw. 30 Tage statt eines Tagespreises. */
export interface ChartPoint {
  date: string;
  value: number;
  average?: 7 | 30;
}

/**
 * Wert der Sammlung zu Cardmarkets Durchschnittspreis der letzten `days` Tage. Karten ohne Durchschnitt zählen mit
 * dem heutigen Preis, Karten ganz ohne Preis gar nicht (wie beim Gesamtwert). undefined, wenn es keine Durchschnitte gibt.
 */
export function averageValue(
  items: CollectionItem[],
  prices: PriceLookup,
  lookup: (gameId: string, printingId: string) => Printing | undefined,
  days: 7 | 30,
): number | undefined {
  let total = 0;
  let found = false;
  for (const item of items) {
    const entry = prices(item.gameId, item.printingId);
    const printing = lookup(item.gameId, item.printingId);
    const now = priceFor(entry, item.finish, printing);
    if (now === undefined) continue;
    const average = priceFor(days === 7 ? { n: entry?.a7, f: entry?.a7f } : { n: entry?.a30, f: entry?.a30f }, item.finish, printing);
    if (average !== undefined) found = true;
    total += (average ?? now) * item.quantity;
  }
  return found ? Math.round(total * 100) / 100 : undefined;
}

/**
 * Wertverlauf für den Zeitraum, endend mit dem heutigen Wert. Solange der eigene Verlauf den Zeitraum nicht abdeckt,
 * beginnt er mit dem Wert zu Cardmarkets 30- bzw. 7-Tage-Durchschnitt am Anfang des jeweiligen Fensters; das ist
 * derselbe Vergleich wie bei den einzelnen Karten (basisFor).
 */
export function valueChart(series: ValuePoint[], today: ValuePoint, days: number | null, averages: Partial<Record<7 | 30, number>>): ChartPoint[] {
  const all: ChartPoint[] = [...series.filter((p) => p.date < today.date), today];
  const points = all.slice(startIndex(all.map((p) => p.date), days));
  const estimates: ChartPoint[] = [];
  for (const w of [30, 7] as const) {
    const value = averages[w];
    const date = shiftDay(today.date, -w);
    if (value !== undefined && (days === null || w <= days) && date < points[0].date) estimates.push({ date, value, average: w });
  }
  return [...estimates, ...points];
}

export interface Mover {
  gameId: string;
  printingId: string;
  finish: Finish;
  quantity: number;
  from: number;
  to: number;
  /** Änderung je Karte in Euro. */
  delta: number;
  /** Änderung als Anteil (0,25 = +25 %). */
  pct: number;
  strong: boolean;
  basis: Basis;
  /** Preise im Zeitraum laut eigenem Verlauf (leer, solange es keinen gibt). */
  series: number[];
}

export function isStrong(from: number, to: number): boolean {
  const delta = Math.round(Math.abs(to - from) * 100) / 100; // in ganzen Cent, sonst ist 0,50 − 0,40 kleiner als 0,10
  if (delta >= STRONG_EUR) return true;
  return from > 0 && delta / from >= STRONG_PCT && delta >= STRONG_MIN_EUR;
}

/**
 * Preisänderung je Druck und Ausführung der Sammlung seit `days` Tagen (null = seit Beginn des Verlaufs).
 * Gleiche Drucke in verschiedenen Sprachen oder Zuständen werden zusammengefasst. Ohne ausreichenden Verlauf
 * vergleicht sie den heutigen Preis aus `prices` mit Cardmarkets Durchschnitt (siehe basisFor).
 */
export function collectionMovers(
  items: CollectionItem[],
  histories: Map<string, PriceHistoryFile>,
  lookup: (gameId: string, printingId: string) => Printing | undefined,
  days: number | null,
  prices?: PriceLookup,
): Mover[] {
  const grouped = new Map<string, Mover>();
  for (const item of items) {
    const key = moverKey(item);
    const known = grouped.get(key);
    if (known) {
      known.quantity += item.quantity;
      continue;
    }
    const printing = lookup(item.gameId, item.printingId);
    const h = histories.get(item.gameId);
    const full = h && h.dates.length > 1 ? itemSeries(h, item, printing) : [];
    const start = h ? startIndex(h.dates, days) : 0;
    const fromHistory = () => (full.length ? { from: full[start], to: full[full.length - 1], basis: { kind: 'history', since: h!.dates[start] } as Basis } : undefined);
    let basis = basisFor(h, days);
    let pair: { from?: number; to?: number; basis: Basis } | undefined;
    if (basis.kind === 'history') pair = fromHistory();
    else {
      const entry = prices?.(item.gameId, item.printingId);
      const average = basis.days === 7 ? { n: entry?.a7, f: entry?.a7f } : { n: entry?.a30, f: entry?.a30f };
      pair = { from: priceFor(average, item.finish, printing), to: priceFor(entry, item.finish, printing), basis };
      if (pair.from === undefined || pair.to === undefined) pair = fromHistory();
    }
    if (pair?.from === undefined || pair.to === undefined) continue;
    const { from, to } = pair;
    basis = pair.basis;
    grouped.set(key, {
      gameId: item.gameId,
      printingId: item.printingId,
      finish: item.finish,
      quantity: item.quantity,
      from,
      to,
      delta: Math.round((to - from) * 100) / 100,
      pct: from > 0 ? (to - from) / from : 0,
      strong: isStrong(from, to),
      basis,
      series: full.slice(start).map((v) => v ?? 0),
    });
  }
  return [...grouped.values()];
}

/** Für die Markierung in der Sammlung: stark bewegte Drucke, Schlüssel „gameId|printingId|finish“. */
export type MoverLookup = Map<string, Mover>;
export const moverKey = (item: Pick<CollectionItem, 'gameId' | 'printingId' | 'finish'>) => `${item.gameId}|${item.printingId}|${item.finish}`;
