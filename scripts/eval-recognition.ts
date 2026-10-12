/**
 * Misst die Erkennungsqualität ohne echte Fotos: Referenzbilder werden verzerrt
 * (Drehung, Scherung, Rand/Ausschnitt, Helligkeit, Unschärfe, JPEG) wie bei einem
 * Handyfoto und dann gegen den Katalog gesucht.
 *   npm run eval -- riftbound [--samples 300]
 * Voraussetzung: `npm run catalog -- <spiel>` ist gelaufen (nutzt dessen Bild-Cache).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createEmbedder } from '../src/core/embedder';
import { parseEmbeddings, type CatalogFile } from '../src/core/catalog';
import { collapseToPrintings, topK } from '../src/core/matcher';
import { imageIn } from '../src/core/catalog';
import { DEFAULT_STABILIZER } from '../src/core/stabilizer';

const args = process.argv.slice(2);
const game = args.find((a) => !a.startsWith('--')) ?? 'riftbound';
const samples = Number(args[args.indexOf('--samples') + 1]) || 300;

// Deterministischer Zufall, damit Läufe vergleichbar sind
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (a: number, b: number) => a + rand() * (b - a);

async function distort(buf: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number; channels: 3 }> {
  const base = sharp(buf).removeAlpha();
  const meta = await base.metadata();
  const w = meta.width!;
  const h = meta.height!;
  // Rand um die Karte (Tisch) oder leicht zu enger Ausschnitt
  const pad = Math.round(h * between(-0.04, 0.1));
  const bg = { r: Math.round(between(20, 230)), g: Math.round(between(20, 230)), b: Math.round(between(20, 230)) };
  let img = pad >= 0
    ? sharp(await base.extend({ top: pad, bottom: pad, left: pad, right: pad, background: bg }).toBuffer())
    : sharp(await base.extract({ left: -pad, top: -pad, width: w + 2 * pad, height: h + 2 * pad }).toBuffer());
  const shear = between(-0.06, 0.06);
  img = sharp(
    await img
      .rotate(between(-5, 5), { background: bg })
      .affine([1, shear, 0, 1], { background: bg })
      .modulate({ brightness: between(0.65, 1.3), saturation: between(0.8, 1.2) })
      .blur(between(0.3, 1.6))
      .jpeg({ quality: Math.round(between(45, 85)) })
      .toBuffer(),
  );
  // Auf Kartenformat zuschneiden wie der Zielrahmen in der App
  const m2 = await img.metadata();
  const targetW = Math.min(m2.width!, Math.round((m2.height! * 63) / 88));
  const targetH = Math.min(m2.height!, Math.round((targetW * 88) / 63));
  const { data, info } = await img
    .extract({ left: Math.floor((m2.width! - targetW) / 2), top: Math.floor((m2.height! - targetH) / 2), width: targetW, height: targetH })
    .resize({ height: 320 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 };
}

async function main() {
  const dir = path.join('public/data', game);
  const file: CatalogFile = JSON.parse(await readFile(path.join(dir, 'catalog.json'), 'utf8'));
  const embeddings = parseEmbeddings((await readFile(path.join(dir, 'embeddings.f32'))).buffer.slice(0) as ArrayBuffer, file.meta);
  const embedder = await createEmbedder({ cacheDir: 'public/models' });

  // Stichprobe über Referenzbilder (alle Sprachen); richtig ist, wenn der Druck stimmt.
  const rowIdx = [...file.refs.keys()].sort(() => rand() - 0.5).slice(0, samples);
  const indices = rowIdx;
  let top1 = 0, top3 = 0, confident = 0, confidentCorrect = 0, sameName = 0;
  const perLang = new Map<string, { n: number; hit: number }>();
  const misses: string[] = [];
  for (const r of rowIdx) {
    const { p: i, lang } = file.refs[r];
    const p = file.printings[i];
    const url = imageIn(p, lang).imageUrl;
    const cached = path.join('.cache/images', createHash('sha1').update(url).digest('hex'));
    const query = await embedder.embed(await distort(await readFile(cached)));
    const res = collapseToPrintings(topK(query, embeddings, file.meta.dim, 9), (row) => file.refs[row].p, 3);
    const hit = res[0].index === i;
    const stat = perLang.get(lang) ?? { n: 0, hit: 0 };
    stat.n++;
    if (hit) stat.hit++;
    perLang.set(lang, stat);
    if (hit) top1++;
    if (res.some((m) => m.index === i)) top3++;
    if (!hit && file.printings[res[0].index].cardName === p.cardName) sameName++;
    const isConfident = res[0].score >= DEFAULT_STABILIZER.minScore && res[0].score - (res[1]?.score ?? 0) >= DEFAULT_STABILIZER.confidentMargin;
    if (isConfident) {
      confident++;
      if (hit) confidentCorrect++;
    }
    if (!hit && misses.length < 15) {
      const got = file.printings[res[0].index];
      misses.push(`${p.printingId} [${lang}] (${p.cardName}, ${p.variant}) → ${got.printingId} (${got.cardName}, ${got.variant}) ${res[0].score.toFixed(3)}`);
    }
  }
  const pct = (n: number, d = indices.length) => `${((100 * n) / d).toFixed(1)} %`;
  console.log(`\n=== Erkennung ${game}: ${indices.length} verzerrte Referenzbilder, Katalog ${file.printings.length} Drucke / ${file.refs.length} Referenzbilder`);
  console.log(`Top-1: ${pct(top1)}   Top-3: ${pct(top3)}`);
  for (const [lang, st] of perLang) console.log(`  Bilder ${lang}: ${st.n}, Top-1 ${pct(st.hit, st.n)}`);
  console.log(`Falsch, aber gleiche Karte in anderer Variante: ${sameName}`);
  console.log(`Als sicher eingestuft: ${pct(confident)}, davon richtig: ${pct(confidentCorrect, confident || 1)}`);
  if (misses.length) console.log(`Beispiele für Fehler:\n  ${misses.join('\n  ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
