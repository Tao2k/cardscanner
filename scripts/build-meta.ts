/**
 * Baut die Turnier-Meta eines Spiels:
 *   npm run meta -- riftbound [--out public/data]
 *
 * Nimmt die Drucke aus dem gebauten Katalog (<out>/<gameId>/catalog.json) und schreibt <out>/<gameId>/meta.json:
 * Decklisten, die bei Turnieren vorne gelandet sind. Daraus baut die App Deckvorschläge.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CatalogFile } from '../src/core/catalog';
import type { MetaFile } from '../src/core/meta';
import { adapters } from './adapters';

async function main() {
  const argv = process.argv.slice(2);
  const game = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? '';
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'public/data';
  const adapter = adapters[game];
  if (!adapter) throw new Error(`Unbekanntes Spiel „${game}“. Verfügbar: ${Object.keys(adapters).join(', ')}`);
  if (!adapter.fetchMeta) {
    console.log(`[${game}] Keine Turnierdaten hinterlegt.`);
    return;
  }
  const catalogFile = path.join(out, game, 'catalog.json');
  const printings = existsSync(catalogFile)
    ? (JSON.parse(await readFile(catalogFile, 'utf8')) as CatalogFile).printings
    : (await adapter.fetchCatalog()).printings;

  const { report, ...result } = await adapter.fetchMeta(printings);
  const events = new Set(result.decks.map((d) => d.event)).size;
  console.log(
    `[${game}] ${result.source}: ${result.decks.length} Listen aus ${events} Turnieren ` +
      `(${report.fetched} geladen, ${report.extra} schwächere Plätze und ${report.community} Community-Decks für seltene Legenden), ${result.decks.at(-1)?.date ?? '–'} bis ${result.decks[0]?.date ?? '–'}`,
  );
  if (report.unknown.length) console.warn(`[${game}] ${report.unknown.length} Kartennummern nicht im Katalog: ${report.unknown.join(', ')}`);
  if (!result.decks.length) throw new Error('Keine einzige Turnierliste.');

  const file: MetaFile = { gameId: game, builtAt: new Date().toISOString(), ...result };
  await mkdir(path.join(out, game), { recursive: true });
  await writeFile(path.join(out, game, 'meta.json'), JSON.stringify(file));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
