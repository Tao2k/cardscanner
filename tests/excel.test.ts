import { describe, expect, it } from 'vitest';
import { compareCollectorNumbers, exportOrder, exportWorkbook, importWorkbook } from '../src/core/excel';
import type { CollectionItem, Printing } from '../src/core/types';

const printing: Printing = {
  printingId: 'ogn-001-298',
  cardName: 'Example Unit',
  setCode: 'OGN',
  collectorNumber: '1',
  variant: 'normal',
  rarity: 'Common',
  names: { fr: 'Unité exemple', 'zh-CN': '示例单位' },
  imageUrl: 'https://example.invalid/1.png',
};
const item: CollectionItem = {
  itemId: 'item-1',
  gameId: 'riftbound',
  printingId: 'ogn-001-298',
  language: 'fr',
  quantity: 3,
  condition: 'LP',
  finish: 'foil',
  location: 'Binder 1',
  notes: 'Geschenk',
  confirmed: false,
  matchScore: 0.8123,
  addedAt: '2026-10-12T20:00:00.000Z',
  updatedAt: '2026-10-12T20:05:00.000Z',
};
const LANGS = ['en', 'fr', 'zh-CN'];
const lookup = (g: string, id: string) => (g === 'riftbound' && id === printing.printingId ? printing : undefined);

describe('Excel', () => {
  it('Export und Import ergeben wieder dieselbe Sammlung', async () => {
    const buf = await exportWorkbook([item], lookup, [{ gameId: 'riftbound', printings: [printing] }]);
    const { items, errors } = await importWorkbook(buf, (g, id) => !!lookup(g, id), LANGS);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ ...item, matchScore: 0.812 }]);
  });

  it('enthält lesbare Spalten und ein Katalogblatt', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportWorkbook([item], lookup, [{ gameId: 'riftbound', printings: [printing] }]));
    const sheet = wb.getWorksheet('Sammlung')!;
    const header = (sheet.getRow(1).values as string[]).slice(1);
    const row = (name: string) => sheet.getRow(2).getCell(header.indexOf(name) + 1).value;
    // Name immer englisch, die Drucksprache steht nur in „Sprache“
    expect(row('Name')).toBe('Example Unit');
    expect(header).not.toContain('Name (EN)');
    expect(row('Sprache')).toBe('fr');
    expect(wb.getWorksheet('Katalog riftbound')!.rowCount).toBe(2);
  });

  it('meldet unbekannte Drucke und ungültige Zeilen', async () => {
    const other = { ...item, itemId: 'item-2', printingId: 'gibt-es-nicht' };
    const buf = await exportWorkbook([item, other], lookup);
    const { items, errors } = await importWorkbook(buf, (g, id) => !!lookup(g, id), LANGS);
    expect(items).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('gibt-es-nicht');
  });

  it('sortiert nach Set (Erscheinungsreihenfolge) und darin nach Kartennummer', async () => {
    const p = (setCode: string, collectorNumber: string): Printing => ({ ...printing, printingId: `${setCode}-${collectorNumber}`, setCode, collectorNumber });
    const printings = [p('SFD', '2'), p('OGN', '10'), p('OGN', '2'), p('OGN', '2a'), p('UNL', '1'), p('OGN', '229*'), p('OGN', '299')];
    const byId = new Map(printings.map((x) => [x.printingId, x]));
    const items = printings.map((x, i) => ({ ...item, itemId: `i${i}`, printingId: x.printingId }));
    // Galerie-Reihenfolge OGN, SFD, UNL; alphabetisch wäre es genauso, daher UNL mit früherem Datum
    const sets = [
      { setId: 'OGN', code: 'OGN', name: 'Origins' },
      { setId: 'SFD', code: 'SFD', name: 'Spiritforged' },
      { setId: 'UNL', code: 'UNL', name: 'Unleashed', releaseDate: '2025-01-01' },
    ];
    const order = exportOrder((_, id) => byId.get(id), new Map([['riftbound', sets]]));
    expect([...items].sort(order).map((i) => i.printingId)).toEqual(['UNL-1', 'OGN-2', 'OGN-2a', 'OGN-10', 'OGN-229*', 'OGN-299', 'SFD-2']);
    expect(compareCollectorNumbers('9', '10')).toBeLessThan(0);

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportWorkbook(items, (_, id) => byId.get(id), [{ gameId: 'riftbound', printings, sets }]));
    const sheet = wb.getWorksheet('Sammlung')!;
    const header = (sheet.getRow(1).values as string[]).slice(1);
    const col = (name: string) => header.indexOf(name) + 1;
    expect(sheet.getRow(2).getCell(col('Set-Name')).value).toBe('Unleashed');
    expect(sheet.getRow(3).getCell(col('Nummer')).value).toBe('2');
  });

  it('schreibt Preis, Wert, Preisstand und die Summe; der Import bleibt gleich', async () => {
    const second = { ...item, itemId: 'item-2', finish: 'normal' as const, quantity: 1 };
    const pricing = (i: CollectionItem) => (i.itemId === 'item-1' ? { price: 1.25, asOf: '21.10.2026' } : {});
    const buf = await exportWorkbook([item, second], lookup, [{ gameId: 'riftbound', printings: [printing] }], pricing);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Sammlung')!;
    const header = (sheet.getRow(1).values as string[]).slice(1);
    const cell = (row: number, name: string) => sheet.getRow(row).getCell(header.indexOf(name) + 1).value;
    // Sortierung: Normal vor Foil
    expect(cell(2, 'Preis (€)')).toBe(null);
    expect(cell(3, 'Preis (€)')).toBe(1.25);
    expect(cell(3, 'Wert (€)')).toBe(3.75);
    expect(cell(3, 'Preisstand')).toBe('21.10.2026');
    expect(cell(5, 'Name')).toBe('Gesamtwert (Cardmarket)');
    expect(cell(5, 'Wert (€)')).toMatchObject({ formula: 'SUM(M2:M3)', result: 3.75 });

    const { items, errors } = await importWorkbook(buf, (g, id) => !!lookup(g, id), LANGS);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(2);
  });

  it('meldet unbekannte Sprachen', async () => {
    const buf = await exportWorkbook([{ ...item, language: 'xx' }], lookup);
    const { items, errors } = await importWorkbook(buf, (g, id) => !!lookup(g, id), LANGS);
    expect(items).toEqual([]);
    expect(errors[0]).toContain('xx');
  });

  it('lehnt Dateien ohne Sammlungsblatt ab', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Irgendwas');
    const { items, errors } = await importWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer, () => true);
    expect(items).toEqual([]);
    expect(errors[0]).toContain('Sammlung');
  });
});
