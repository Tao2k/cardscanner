import type { Workbook } from 'exceljs';
import type { CollectionItem, Condition, Finish, Printing } from './types';

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
  { header: 'Nummer', key: 'collectorNumber', width: 9 },
  { header: 'Name', key: 'cardName', width: 36 },
  { header: 'Variante', key: 'variant', width: 13 },
  { header: 'Seltenheit', key: 'rarity', width: 12 },
  { header: 'Anzahl', key: 'quantity', width: 8 },
  { header: 'Zustand', key: 'condition', width: 9 },
  { header: 'Finish', key: 'finish', width: 9 },
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

export async function exportWorkbook(
  items: CollectionItem[],
  lookup: PrintingLookup,
  catalogs: { gameId: string; printings: Printing[] }[] = [],
): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  wb.creator = 'CardScanner';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Sammlung', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLLECTION_COLUMNS.map((c) => ({ ...c }));
  const sorted = [...items].sort((a, b) => {
    const pa = lookup(a.gameId, a.printingId);
    const pb = lookup(b.gameId, b.printingId);
    return (
      a.gameId.localeCompare(b.gameId) ||
      (pa?.setCode ?? '').localeCompare(pb?.setCode ?? '') ||
      (pa?.collectorNumber ?? '').localeCompare(pb?.collectorNumber ?? '', undefined, { numeric: true })
    );
  });
  for (const item of sorted) {
    const p = lookup(item.gameId, item.printingId);
    sheet.addRow({
      ...item,
      setCode: p?.setCode ?? '',
      collectorNumber: p?.collectorNumber ?? '',
      cardName: p?.cardName ?? '(unbekannter Druck)',
      variant: p?.variant ?? '',
      rarity: p?.rarity ?? '',
      confirmed: item.confirmed ? 'ja' : 'nein',
      matchScore: item.matchScore === undefined ? '' : Math.round(item.matchScore * 1000) / 1000,
    });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: COLLECTION_COLUMNS.length } };

  for (const { gameId, printings } of catalogs) {
    const cat = wb.addWorksheet(`Katalog ${gameId}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    cat.columns = [
      { header: 'Set', key: 'setCode', width: 8 },
      { header: 'Nummer', key: 'collectorNumber', width: 9 },
      { header: 'Name', key: 'cardName', width: 36 },
      { header: 'Variante', key: 'variant', width: 13 },
      { header: 'Seltenheit', key: 'rarity', width: 12 },
      { header: 'Typ', key: 'type', width: 14 },
      { header: 'Druck-ID', key: 'printingId', width: 24 },
    ];
    for (const p of printings) cat.addRow(p);
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
    items.push({
      itemId: get('Eintrag-ID') || globalThis.crypto.randomUUID(),
      gameId,
      printingId,
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
