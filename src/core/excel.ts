import type { Workbook } from 'exceljs';
import type { CardSet, CollectionItem, Condition, Finish, Printing } from './types';

/** Lädt exceljs erst bei Bedarf (das Paket ist groß und wird nur für Export/Import gebraucht). */
async function newWorkbook(): Promise<Workbook> {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  return new ExcelJS.Workbook();
}

export type PrintingLookup = (gameId: string, printingId: string) => Printing | undefined;

/** Spalten des Blatts „Sammlung“. Die Reihenfolge ist auch die Reihenfolge in Excel. */
export const COLLECTION_COLUMNS = [
  { header: 'Spiel', key: 'gameId', width: 12 },
  { header: 'Set', key: 'setCode', width: 8 },
  { header: 'Set-Name', key: 'setName', width: 22 },
  { header: 'Nummer', key: 'collectorNumber', width: 9 },
  { header: 'Name', key: 'cardName', width: 36 },
  { header: 'Sprache', key: 'language', width: 9 },
  { header: 'Variante', key: 'variant', width: 13 },
  { header: 'Seltenheit', key: 'rarity', width: 12 },
  { header: 'Anzahl', key: 'quantity', width: 8 },
  { header: 'Zustand', key: 'condition', width: 9 },
  { header: 'Finish', key: 'finish', width: 9 },
  { header: 'Preis (€)', key: 'price', width: 10 },
  { header: 'Wert (€)', key: 'value', width: 10 },
  { header: 'Preisstand', key: 'priceAsOf', width: 11 },
  { header: 'Lagerort', key: 'location', width: 18 },
  { header: 'Bestätigt', key: 'confirmed', width: 10 },
  { header: 'Erkennungswert', key: 'matchScore', width: 15 },
  { header: 'Hinzugefügt', key: 'addedAt', width: 22 },
  { header: 'Geändert', key: 'updatedAt', width: 22 },
  { header: 'Notizen', key: 'notes', width: 30 },
  { header: 'Druck-ID', key: 'printingId', width: 24 },
  { header: 'Eintrag-ID', key: 'itemId', width: 38 },
] as const;

const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const FINISHES: Finish[] = ['normal', 'foil'];

/**
 * Reihenfolge der Sets: nach Erscheinungsdatum, wo der Katalog eins kennt; Sets ohne Datum danach in
 * Katalogreihenfolge, Sets, die der Katalog gar nicht kennt, ganz am Ende (alphabetisch).
 */
export function setRanks(sets: CardSet[]): Map<string, number> {
  const ordered = sets
    .map((set, i) => ({ set, i }))
    .sort((a, b) => (a.set.releaseDate ?? '9999').localeCompare(b.set.releaseDate ?? '9999') || a.i - b.i);
  return new Map(ordered.map(({ set }, rank) => [set.code, rank]));
}

/** Sammlernummer zum Sortieren: Zahl, dann Zusatz („123“ < „123a“ < „123*“). */
function numberKey(n: string): [number, string] {
  const m = n.trim().match(/^(\d+)(.*)$/);
  return m ? [Number(m[1]), m[2].toLowerCase()] : [Number.POSITIVE_INFINITY, n.toLowerCase()];
}

export function compareCollectorNumbers(a: string, b: string): number {
  const [na, sa] = numberKey(a);
  const [nb, sb] = numberKey(b);
  return na - nb || (sa === sb ? 0 : sa === '' ? -1 : sb === '' ? 1 : sa.localeCompare(sb));
}

/**
 * Sortierung des Exports: Spiel, Set (nach Erscheinen), Kartennummer; bei gleichem Druck Sprache,
 * Normal vor Foil, besserer Zustand zuerst.
 */
export function exportOrder(lookup: PrintingLookup, sets: Map<string, CardSet[]> = new Map()) {
  const ranks = new Map([...sets].map(([gameId, list]) => [gameId, setRanks(list)]));
  const rankOf = (gameId: string, code: string) => ranks.get(gameId)?.get(code) ?? Number.POSITIVE_INFINITY;
  return (a: CollectionItem, b: CollectionItem): number => {
    const pa = lookup(a.gameId, a.printingId);
    const pb = lookup(b.gameId, b.printingId);
    const sa = pa?.setCode ?? '', sb = pb?.setCode ?? '';
    const ra = rankOf(a.gameId, sa), rb = rankOf(b.gameId, sb);
    return (
      a.gameId.localeCompare(b.gameId) ||
      (ra === rb ? 0 : ra < rb ? -1 : 1) ||
      sa.localeCompare(sb) ||
      compareCollectorNumbers(pa?.collectorNumber ?? '', pb?.collectorNumber ?? '') ||
      (pa?.cardName ?? '').localeCompare(pb?.cardName ?? '') ||
      a.language.localeCompare(b.language) ||
      FINISHES.indexOf(a.finish) - FINISHES.indexOf(b.finish) ||
      CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)
    );
  };
}

/** Marktpreis eines Eintrags (pro Stück) und Datum des Preisstands, z. B. „21.10.2026“. */
export type ItemPricing = (item: CollectionItem, printing?: Printing) => { price?: number; asOf?: string };

export async function exportWorkbook(
  items: CollectionItem[],
  lookup: PrintingLookup,
  catalogs: { gameId: string; printings: Printing[]; sets?: CardSet[] }[] = [],
  pricing?: ItemPricing,
): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  wb.creator = 'CardScanner';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Sammlung', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLLECTION_COLUMNS.map((c) => ({ ...c }));
  const sets = new Map(catalogs.map((c) => [c.gameId, c.sets ?? []]));
  const setNames = new Map(catalogs.flatMap((c) => (c.sets ?? []).map((s) => [`${c.gameId}/${s.code}`, s.name] as const)));
  const sorted = [...items].sort(exportOrder(lookup, sets));
  let totalValue = 0;
  for (const item of sorted) {
    const p = lookup(item.gameId, item.printingId);
    const { price, asOf } = pricing?.(item, p) ?? {};
    const value = price === undefined ? undefined : Math.round(price * item.quantity * 100) / 100;
    totalValue += value ?? 0;
    sheet.addRow({
      ...item,
      setCode: p?.setCode ?? '',
      setName: p ? (setNames.get(`${item.gameId}/${p.setCode}`) ?? '') : '',
      collectorNumber: p?.collectorNumber ?? '',
      cardName: p ? p.cardName : '(unbekannter Druck)',
      variant: p?.variant ?? '',
      rarity: p?.rarity ?? '',
      confirmed: item.confirmed ? 'ja' : 'nein',
      matchScore: item.matchScore === undefined ? '' : Math.round(item.matchScore * 1000) / 1000,
      // leer statt '' lassen, damit Excel mit den Spalten rechnen kann
      price: price ?? null,
      value: value ?? null,
      priceAsOf: price === undefined ? null : (asOf ?? null),
    });
  }
  sheet.getColumn('price').numFmt = '0.00';
  sheet.getColumn('value').numFmt = '0.00';
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: COLLECTION_COLUMNS.length } };
  if (pricing && sorted.length) {
    // Summe mit Abstand unter der Tabelle; ohne Spiel und Druck-ID überspringt der Import die Zeile.
    const valueCol = sheet.getColumn('value').letter;
    const total = sheet.getRow(sorted.length + 3);
    total.getCell('cardName').value = 'Gesamtwert (Cardmarket)';
    total.getCell('value').value = { formula: `SUM(${valueCol}2:${valueCol}${sorted.length + 1})`, result: Math.round(totalValue * 100) / 100 };
    total.font = { bold: true };
  }

  for (const { gameId, printings } of catalogs) {
    const cat = wb.addWorksheet(`Katalog ${gameId}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    cat.columns = [
      { header: 'Set', key: 'setCode', width: 8 },
      { header: 'Nummer', key: 'collectorNumber', width: 9 },
      { header: 'Name', key: 'cardName', width: 36 },
      { header: 'Name (FR)', key: 'nameFr', width: 36 },
      { header: 'Name (ZH)', key: 'nameZh', width: 24 },
      { header: 'Variante', key: 'variant', width: 13 },
      { header: 'Seltenheit', key: 'rarity', width: 12 },
      { header: 'Typ', key: 'type', width: 14 },
      { header: 'Druck-ID', key: 'printingId', width: 24 },
    ];
    const ranks = setRanks(sets.get(gameId) ?? []);
    const rank = (p: Printing) => ranks.get(p.setCode) ?? Number.POSITIVE_INFINITY;
    const inOrder = [...printings].sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || a.setCode.localeCompare(b.setCode) || compareCollectorNumbers(a.collectorNumber, b.collectorNumber));
    for (const p of inOrder) cat.addRow({ ...p, nameFr: p.names?.fr ?? '', nameZh: p.names?.['zh-CN'] ?? '' });
    cat.getRow(1).font = { bold: true };
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export interface ImportResult {
  items: CollectionItem[];
  errors: string[];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return cellText(v.result);
  }
  return String(value).trim();
}

/**
 * Liest das Blatt „Sammlung“ einer zuvor exportierten (und ggf. in Excel bearbeiteten) Datei.
 * Zeilen ohne Druck-ID werden übersprungen und als Fehler gemeldet; fehlende Eintrag-IDs
 * (neu in Excel angelegte Zeilen) bekommen eine neue ID.
 */
export async function importWorkbook(
  data: ArrayBuffer,
  isKnownPrinting: (gameId: string, printingId: string) => boolean,
  languages: string[] = ['en'],
): Promise<ImportResult> {
  const wb = await newWorkbook();
  await wb.xlsx.load(data);
  const sheet = wb.getWorksheet('Sammlung');
  if (!sheet) return { items: [], errors: ['Kein Blatt „Sammlung“ gefunden.'] };

  const headerIndex = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => headerIndex.set(cellText(cell.value), col));
  const missing = ['Spiel', 'Druck-ID', 'Anzahl'].filter((h) => !headerIndex.has(h));
  if (missing.length) return { items: [], errors: [`Spalten fehlen: ${missing.join(', ')}`] };

  const items: CollectionItem[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (header: string) => {
      const col = headerIndex.get(header);
      return col ? cellText(row.getCell(col).value) : '';
    };
    const gameId = get('Spiel');
    const printingId = get('Druck-ID');
    if (!gameId && !printingId) return;
    if (!gameId || !printingId) {
      errors.push(`Zeile ${rowNumber}: Spiel oder Druck-ID fehlt.`);
      return;
    }
    if (!isKnownPrinting(gameId, printingId)) {
      errors.push(`Zeile ${rowNumber}: Druck ${printingId} ist im Katalog ${gameId} unbekannt.`);
      return;
    }
    const quantity = Number.parseInt(get('Anzahl'), 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`Zeile ${rowNumber}: Anzahl „${get('Anzahl')}“ ist ungültig.`);
      return;
    }
    const condition = get('Zustand').toUpperCase() as Condition;
    const finish = get('Finish').toLowerCase() as Finish;
    const score = Number.parseFloat(get('Erkennungswert'));
    const language = languages.find((l) => l.toLowerCase() === get('Sprache').toLowerCase());
    if (get('Sprache') && !language) {
      errors.push(`Zeile ${rowNumber}: Sprache „${get('Sprache')}“ unbekannt (erlaubt: ${languages.join(', ')}).`);
      return;
    }
    items.push({
      itemId: get('Eintrag-ID') || globalThis.crypto.randomUUID(),
      gameId,
      printingId,
      language: language ?? languages[0],
      quantity,
      condition: CONDITIONS.includes(condition) ? condition : 'NM',
      finish: FINISHES.includes(finish) ? finish : 'normal',
      location: get('Lagerort'),
      notes: get('Notizen'),
      confirmed: get('Bestätigt').toLowerCase() !== 'nein',
      matchScore: Number.isFinite(score) ? score : undefined,
      addedAt: get('Hinzugefügt') || now,
      updatedAt: get('Geändert') || now,
    });
  });
  return { items, errors };
}
