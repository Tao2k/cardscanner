import { priceFor, type PriceFile } from './prices';
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
  series: number[];
}

export function isStrong(from: number, to: number): boolean {
  const delta = Math.round(Math.abs(to - from) * 100) / 100; // in ganzen Cent, sonst ist 0,50 − 0,40 kleiner als 0,10
  if (delta >= STRONG_EUR) return true;
  return from > 0 && delta / from >= STRONG_PCT && delta >= STRONG_MIN_EUR;
}

/**
 * Preisänderung je Druck und Ausführung der Sammlung seit `days` Tagen (null = seit Beginn des Verlaufs).
 * Gleiche Drucke in verschiedenen Sprachen oder Zuständen werden zusammengefasst.
 */
export function collectionMovers(
  items: CollectionItem[],
  histories: Map<string, PriceHistoryFile>,
  lookup: (gameId: string, printingId: string) => Printing | undefined,
  days: number | null,
): Mover[] {
  const grouped = new Map<string, Mover>();
  for (const item of items) {
    const key = `${item.gameId}|${item.printingId}|${item.finish}`;
    const known = grouped.get(key);
    if (known) {
      known.quantity += item.quantity;
      continue;
    }
    const h = histories.get(item.gameId);
    if (!h?.dates.length) continue;
    const series = itemSeries(h, item, lookup(item.gameId, item.printingId));
    const start = startIndex(h.dates, days);
    const from = series[start];
    const to = series[series.length - 1];
    if (from === undefined || to === undefined) continue;
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
      series: series.slice(start).map((v) => v ?? 0),
    });
  }
  return [...grouped.values()];
}

/** Für die Markierung in der Sammlung: stark bewegte Drucke, Schlüssel „gameId|printingId|finish“. */
export type MoverLookup = Map<string, Mover>;
export const moverKey = (item: Pick<CollectionItem, 'gameId' | 'printingId' | 'finish'>) => `${item.gameId}|${item.printingId}|${item.finish}`;
