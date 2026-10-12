/**
 * Baut den Erkennungskatalog eines Spiels:
 *   npm run catalog -- riftbound [--limit 50] [--out public/data]
 *
 * Lädt Kartendaten und Referenzbilder über den Spiel-Adapter, berechnet pro Druck ein
 * Bild-Embedding und schreibt catalog.json + embeddings.f32 nach <out>/<gameId>/.
 * Das Modell landet in public/models/ und wird mit der App ausgeliefert.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createEmbedder, MODEL_ID } from '../src/core/embedder';
import type { CatalogFile, GameEntry } from '../src/core/catalog';
import type { Pixels } from '../src/core/imageops';
import type { ReferenceRow } from '../src/core/types';
import { adapters } from './adapters';

const IMAGE_CACHE = '.cache/images';
const MODEL_DIR = 'public/models';
const DOWNLOAD_CONCURRENCY = 4;

function parseArgs(argv: string[]) {
  const args = { game: '', limit: undefined as number | undefined, out: 'public/data' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (!args.game) args.game = argv[i];
  }
  return args;
}

async function fetchImage(url: string): Promise<Buffer> {
  const file = path.join(IMAGE_CACHE, createHash('sha1').update(url).digest('hex'));
  if (existsSync(file)) return readFile(file);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'CardScanner/0.1 (+https://github.com/Tao2k/cardscanner)' } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    }
    if (attempt >= 3) throw new Error(`HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function decode(buf: Buffer): Promise<Pixels> {
  const { data, info } = await sharp(buf).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 };
}

/** Lädt Bilder parallel, rechnet aber in Eingabereihenfolge (das Modell läuft ohnehin seriell). */
async function* imagesInOrder(urls: string[]) {
  const pending = new Map<number, Promise<Buffer | Error>>();
  let next = 0;
  const start = () => {
    while (pending.size < DOWNLOAD_CONCURRENCY && next < urls.length) {
      const i = next++;
      pending.set(i, fetchImage(urls[i]).catch((e: Error) => e));
    }
  };
  for (let i = 0; i < urls.length; i++) {
    start();
    const result = await pending.get(i)!;
    pending.delete(i);
    yield { index: i, result };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adapter = adapters[args.game];
  if (!adapter) {
    console.error(`Unbekanntes Spiel „${args.game}“. Verfügbar: ${Object.keys(adapters).join(', ')}`);
    process.exit(1);
  }
  await mkdir(IMAGE_CACHE, { recursive: true });
  const outDir = path.join(args.out, adapter.gameId);
  await mkdir(outDir, { recursive: true });

  console.log(`[${adapter.gameId}] Lade Katalog von ${adapter.source}`);
  const { sets, printings } = await adapter.fetchCatalog({ limit: args.limit });
  console.log(`[${adapter.gameId}] ${printings.length} Drucke in ${sets.length} Sets`);

  // Ein Referenzbild je Druck (englisch) plus abweichende Bilder anderer Sprachen.
  const rows: ReferenceRow[] = [];
  const urls: string[] = [];
  printings.forEach((p, i) => {
    rows.push({ p: i, lang: adapter.languages[0].code });
    urls.push(p.imageUrl);
    for (const [lang, img] of Object.entries(p.images ?? {})) {
      rows.push({ p: i, lang });
      urls.push(img.imageUrl);
    }
  });
  console.log(`[${adapter.gameId}] ${rows.length} Referenzbilder`);

  const embedder = await createEmbedder({ cacheDir: MODEL_DIR });
  const keptRows: ReferenceRow[] = [];
  const vectors: Float32Array[] = [];
  const failed: string[] = [];
  let done = 0;
  for await (const { index, result } of imagesInOrder(urls)) {
    done++;
    const row = rows[index];
    try {
      if (result instanceof Error) throw result;
      vectors.push(await embedder.embed(await decode(result)));
      keptRows.push(row);
    } catch (e) {
      failed.push(`${printings[row.p].printingId} [${row.lang}] (${(e as Error).message})`);
    }
    if (done % 100 === 0 || done === urls.length) console.log(`  ${done}/${urls.length}`);
  }
  if (failed.length) console.warn(`[${adapter.gameId}] ${failed.length} Bilder übersprungen:\n  ${failed.join('\n  ')}`);
  if (!keptRows.length) throw new Error('Kein einziges Referenzbild verarbeitet.');

  const dim = vectors[0].length;
  const embeddings = new Float32Array(keptRows.length * dim);
  vectors.forEach((v, i) => embeddings.set(v, i * dim));

  const builtAt = new Date().toISOString();
  const file: CatalogFile = {
    meta: {
      gameId: adapter.gameId,
      gameName: adapter.gameName,
      source: adapter.source,
      builtAt,
      model: embedder.model,
      dim,
      count: keptRows.length,
      sets,
      languages: adapter.languages,
    },
    printings,
    refs: keptRows,
  };
  await writeFile(path.join(outDir, 'catalog.json'), JSON.stringify(file));
  await writeFile(path.join(outDir, 'embeddings.f32'), Buffer.from(embeddings.buffer));

  const gamesFile = path.join(args.out, 'games.json');
  const games: GameEntry[] = existsSync(gamesFile) ? JSON.parse(await readFile(gamesFile, 'utf8')) : [];
  const entry: GameEntry = { gameId: adapter.gameId, gameName: adapter.gameName, count: printings.length, builtAt };
  await writeFile(gamesFile, JSON.stringify([...games.filter((g) => g.gameId !== entry.gameId), entry], null, 2));

  console.log(`[${adapter.gameId}] Fertig: ${printings.length} Drucke, ${keptRows.length} Referenzbilder, ${dim} Dimensionen, Modell ${MODEL_ID}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
