import { describe, expect, it } from 'vitest';
import { exportWorkbook, importWorkbook } from '../src/core/excel';
import type { CollectionItem, Printing } from '../src/core/types';

const printing: Printing = {
  printingId: 'ogn-001-298',
  cardName: 'Example Unit',
  setCode: 'OGN',
  collectorNumber: '1',
  variant: 'normal',
  language: 'en',
  rarity: 'Common',
  imageUrl: 'https://example.invalid/1.png',
};
const item: CollectionItem = {
  itemId: 'item-1',
  gameId: 'riftbound',
  printingId: 'ogn-001-298',
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
const lookup = (g: string, id: string) => (g === 'riftbound' && id === printing.printingId ? printing : undefined);

describe('Excel', () => {
  it('Export und Import ergeben wieder dieselbe Sammlung', async () => {
    const buf = await exportWorkbook([item], lookup, [{ gameId: 'riftbound', printings: [printing] }]);
    const { items, errors } = await importWorkbook(buf, (g, id) => !!lookup(g, id));
    expect(errors).toEqual([]);
    expect(items).toEqual([{ ...item, matchScore: 0.812 }]);
  });

  it('enthält lesbare Spalten und ein Katalogblatt', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportWorkbook([item], lookup, [{ gameId: 'riftbound', printings: [printing] }]));
    const sheet = wb.getWorksheet('Sammlung')!;
    expect(sheet.getRow(1).getCell(4).value).toBe('Name');
    expect(sheet.getRow(2).getCell(4).value).toBe('Example Unit');
    expect(wb.getWorksheet('Katalog riftbound')!.rowCount).toBe(2);
  });

  it('meldet unbekannte Drucke und ungültige Zeilen', async () => {
    const other = { ...item, itemId: 'item-2', printingId: 'gibt-es-nicht' };
    const buf = await exportWorkbook([item, other], lookup);
    const { items, errors } = await importWorkbook(buf, (g, id) => !!lookup(g, id));
    expect(items).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('gibt-es-nicht');
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
