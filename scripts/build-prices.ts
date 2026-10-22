/**
 * Baut die Preisdatei eines Spiels:
 *   npm run prices -- riftbound [--out public/data]
 *
 * Nimmt die Drucke aus dem gebauten Katalog (<out>/<gameId>/catalog.json), sonst direkt vom Adapter,
 * und schreibt <out>/<gameId>/prices.json. Getrennt vom Katalog, damit Preise täglich neu kommen.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CatalogFile } from '../src/core/catalog';
import type { PriceFile } from '../src/core/prices';
import { adapters } from './adapters';

async function main() {
  const argv = process.argv.slice(2);
  const game = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? '';
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'public/data';
  const adapter = adapters[game];
  if (!adapter) throw new Error(`Unbekanntes Spiel „${game}“. Verfügbar: ${Object.keys(adapters).join(', ')}`);
  if (!adapter.fetchPrices) {
    console.log(`[${game}] Keine Preisquelle hinterlegt.`);
    return;
  }

  const catalogFile = path.join(out, game, 'catalog.json');
  const printings = existsSync(catalogFile)
    ? (JSON.parse(await readFile(catalogFile, 'utf8')) as CatalogFile).printings
    : (await adapter.fetchCatalog()).printings;

  const { report, ...result } = await adapter.fetchPrices(printings);
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, report.printings))} %`;
  console.log(
    `[${game}] ${result.source}, Stand ${result.asOf}: ${report.linked} von ${report.printings} Drucken zugeordnet (${pct(report.linked)}, ` +
      `davon ${report.byName} über den Namen), ${report.priced} mit Preis (${pct(report.priced)})`,
  );
  if (report.rejected.length) console.warn(`[${game}] ${report.rejected.length} unsichere Zuordnungen verworfen:\n  ${report.rejected.join('\n  ')}`);
  const unlinked = printings.filter((p) => !result.prices[p.printingId]).map((p) => `${p.setCode} ${p.collectorNumber} ${p.cardName}`);
  if (unlinked.length) console.log(`[${game}] Ohne Preis:\n  ${unlinked.join('\n  ')}`);
  if (!report.priced) throw new Error('Kein einziger Preis zugeordnet.');

  const file: PriceFile = { gameId: game, currency: 'EUR', builtAt: new Date().toISOString(), ...result };
  await mkdir(path.join(out, game), { recursive: true });
  await writeFile(path.join(out, game, 'prices.json'), JSON.stringify(file));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
