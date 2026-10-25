/**
 * Schreibt den Preisverlauf eines Spiels fort:
 *   npm run price-history -- riftbound --history .history [--out public/data]
 *
 * Liest den bisherigen Verlauf aus <history>/<gameId>.json, hängt den heutigen Preisstand aus
 * <out>/<gameId>/prices.json an und schreibt ihn zurück sowie nach <out>/<gameId>/price-history.json.
 * Fehlen heutige Preise, wird nur der bisherige Verlauf veröffentlicht.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PriceFile } from '../src/core/prices';
import { appendSnapshot, type PriceHistoryFile } from '../src/core/priceHistory';

const readJson = async <T>(file: string): Promise<T | null> => (existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as T) : null);

async function main() {
  const argv = process.argv.slice(2);
  const option = (name: string, fallback: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const game = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? '';
  const out = option('--out', 'public/data');
  const historyDir = option('--history', '.history');
  if (!game) throw new Error('Spiel fehlt, z. B. „npm run price-history -- riftbound“.');

  const historyFile = path.join(historyDir, `${game}.json`);
  const previous = await readJson<PriceHistoryFile>(historyFile);
  const prices = await readJson<PriceFile>(path.join(out, game, 'prices.json'));
  if (!prices && !previous) {
    console.log(`[${game}] Weder Preise noch Verlauf vorhanden.`);
    return;
  }
  const history = prices ? appendSnapshot(previous, prices) : previous!;
  const json = JSON.stringify(history);
  await mkdir(historyDir, { recursive: true });
  await mkdir(path.join(out, game), { recursive: true });
  await writeFile(historyFile, json);
  await writeFile(path.join(out, game, 'price-history.json'), json);
  console.log(
    `[${game}] Preisverlauf: ${history.dates.length} Tage (${history.dates[0]} bis ${history.dates[history.dates.length - 1]}), ` +
      `${Object.keys(history.n).length + Object.keys(history.f).length} Reihen, ${Math.round(json.length / 1024)} KB` +
      (prices ? '' : ', heute ohne neue Preise'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
