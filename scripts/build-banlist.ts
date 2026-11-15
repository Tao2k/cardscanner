/**
 * Banlist eines Spiels aktualisieren:
 *   npm run banlist -- riftbound [--out public/data]
 *
 * Grundstock ist die eingebaute Liste (src/core/banlist.ts). Dazu kommen Bann-Artikel aus Riots Ankündigungen,
 * die dort noch nicht stehen. Ergebnis: <out>/<gameId>/banlist.json, die die App beim Deckbau lädt.
 * Findet das Skript einen neuen Artikel, meldet es ihn im Actions-Protokoll, damit die eingebaute Liste
 * (mit Quelle) nachgezogen werden kann.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { banKey, BUILTIN_BANLISTS } from '../src/core/banlist';
import type { CatalogFile } from '../src/core/catalog';
import { deckPool } from '../src/core/deck';
import { fetchBanArticles, mergeBanArticles } from './adapters/riftbound-banlist';

const FETCHERS: Record<string, typeof fetchBanArticles> = { riftbound: fetchBanArticles };

async function main() {
  const argv = process.argv.slice(2);
  const game = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? '';
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'public/data';
  const base = BUILTIN_BANLISTS[game];
  if (!base) throw new Error(`Keine Banlist für „${game}“. Verfügbar: ${Object.keys(BUILTIN_BANLISTS).join(', ')}`);
  const target = path.join(out, game, 'banlist.json');
  await mkdir(path.join(out, game), { recursive: true });
  // Zuerst die eingebaute Liste schreiben: Fällt Riots Seite aus, hat die App trotzdem eine
  await writeFile(target, JSON.stringify({ ...base, checkedAt: new Date().toISOString() }));

  const catalogFile = path.join(out, game, 'catalog.json');
  if (!existsSync(catalogFile)) throw new Error(`${catalogFile} fehlt; erst den Katalog bauen.`);
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8')) as CatalogFile;
  const pool = deckPool(game, catalog.printings, catalog.meta.sets ?? []);
  const names = new Set<string>();
  for (const c of pool.cards.values()) {
    names.add(banKey(c.id));
    if (c.kind === 'legend' && c.championOf) names.add(banKey(`${c.championOf}, ${c.name}`));
  }
  const missing = base.entries.filter((e) => !names.has(banKey(e.name))).map((e) => e.name);
  if (missing.length) console.warn(`::warning::[${game}] Gesperrte Karten nicht im Katalog: ${missing.join(', ')}`);

  const today = new Date().toISOString().slice(0, 10);
  const articles = await FETCHERS[game]();
  const { file, articles: fresh, unknown } = mergeBanArticles(base, articles, names, today);
  console.log(`[${game}] ${articles.length} Bann-Artikel gefunden, davon ${fresh.length} neu; ${file.entries.length} Einträge auf der Liste.`);
  for (const a of fresh) {
    console.log(`::notice::[${game}] Neuer Bann-Artikel: ${a.title} (${a.url}), gültig ab ${a.effective ?? '?'}; gesperrt: ${a.added.join(', ') || '–'}; frei: ${a.removed.join(', ') || '–'}`);
  }
  if (unknown.length) console.warn(`::warning::[${game}] Nicht übernommen (keine Karte dieses Namens): ${unknown.join(', ')}`);
  await writeFile(target, JSON.stringify(file));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
