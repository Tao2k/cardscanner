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
import { detectLanguage, isHanLanguage, languageFromImage, TEXT_REGION } from '../src/core/language';
import { OCR_MODELS } from '../src/app/ocr';
import { AdaptiveIndex, DEFAULT_LEARNING, type SampleSource } from '../src/core/learning';
import type { Embedder } from '../src/core/embedder';
import { estimateCondition, toGray, type Gray } from '../src/core/condition';
import { grayReference } from './gray';

const args = process.argv.slice(2);
const game = args.find((a) => !a.startsWith('--')) ?? 'riftbound';
const samples = Number(args[args.indexOf('--samples') + 1]) || 300;
const option = (name: string, fallback: number) => {
  if (!args.includes(name)) return 0;
  const value = Number(args[args.indexOf(name) + 1]);
  return Number.isNaN(value) ? fallback : value;
};
const ocrSamples = option('--ocr', 60);
const learnSamples = option('--learn', 200);
const conditionSamples = option('--condition', 40);
const cardName = args.includes('--card') ? args[args.indexOf('--card') + 1] : '';

// Deterministischer Zufall, damit Läufe vergleichbar sind
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (a: number, b: number) => a + rand() * (b - a);

async function distortTo(buf: Buffer, outHeight: number): Promise<sharp.Sharp> {
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
  return img
    .extract({ left: Math.floor((m2.width! - targetW) / 2), top: Math.floor((m2.height! - targetH) / 2), width: targetW, height: targetH })
    .resize({ height: outHeight });
}

async function distort(buf: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number; channels: 3 }> {
  const { data, info } = await (await distortTo(buf, 320)).raw().toBuffer({ resolveWithObject: true });
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
  if (conditionSamples) await evalCondition(file, conditionSamples);
  if (learnSamples) await evalLearning(file, embeddings, embedder, learnSamples);
  if (ocrSamples || cardName) await evalLanguage(file, ocrSamples, embeddings, embedder);
}

/**
 * Zustandsschätzung: Referenzbilder bekommen künstliche weiße Abnutzung an den Kanten, werden leicht
 * gedreht auf Unterlagen verschiedener Helligkeit gelegt, unscharf und als JPEG gespeichert.
 * Misst nur, ob das Verfahren funktioniert; echte Abnutzung sieht anders aus als diese Simulation.
 */
async function evalCondition(file: CatalogFile, n: number) {
  const rows = [...file.refs.keys()].filter((r) => file.refs[r].lang === 'en').sort(() => rand() - 0.5).slice(0, n);
  const levels = [
    { name: 'sauber', specks: 0 },
    { name: 'leicht', specks: 8 },
    { name: 'mittel', specks: 35 },
    { name: 'stark', specks: 140 },
  ];
  const tables = [
    { name: 'schwarz', v: 15 },
    { name: 'dunkelgrau', v: 60 },
    { name: 'mittelgrau', v: 110 },
    { name: 'weiß', v: 225 },
  ];
  // Einmal zeigen, wie die Referenzbilder aussehen (Größe, Transparenz, Rand)
  {
    const p = file.printings[file.refs[rows[0]].p];
    const buf = await readFile(path.join('.cache/images', createHash('sha1').update(p.imageUrl).digest('hex')));
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    let ring = 0, cnt = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const d = Math.min(x, y, info.width - 1 - x, info.height - 1 - y);
      if (d < info.width * 0.03 && y > info.height * 0.1 && y < info.height * 0.9) {
        const k = (y * info.width + x) * 4;
        ring += 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
        cnt++;
      }
    }
    console.log(`\nReferenzbild ${p.printingId}: ${info.width}×${info.height}, Ecke RGBA ${px(0, 0)}, Rand Mitte links ${px(2, info.height >> 1)}, Randhelligkeit ${(ring / cnt).toFixed(0)}`);
  }

  const results = new Map<string, Map<string, number>>();
  const metrics = new Map<string, number[][]>();
  for (const r of rows) {
    const p = file.printings[file.refs[r].p];
    const buf = await readFile(path.join('.cache/images', createHash('sha1').update(p.imageUrl).digest('hex')));
    const ref = await grayOf(grayReference(buf));
    const { data: card, info } = await sharp(buf).resize({ height: 670 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const radius = (3 / 63) * w;
    // Abgerundete Ecken freistellen, falls das Bild keine Transparenz hat
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cx = Math.min(Math.max(x + 0.5, radius), w - radius), cy = Math.min(Math.max(y + 0.5, radius), h - radius);
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) card[(y * w + x) * 4 + 3] = 0;
    }
    for (const level of levels) {
      const worn = Buffer.from(card);
      for (let i = 0; i < level.specks; i++) {
        const side = Math.floor(rand() * 4), t = rand(), rad = between(1.5, 4.5);
        const [sx, sy] = side === 0 ? [t * w, 0] : side === 1 ? [w - 1, t * h] : side === 2 ? [t * w, h - 1] : [0, t * h];
        for (let y = Math.floor(sy - rad); y <= sy + rad; y++) for (let x = Math.floor(sx - rad); x <= sx + rad; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h || Math.hypot(x - sx, y - sy) > rad) continue;
          const k = (y * w + x) * 4;
          if (worn[k + 3] === 0) continue;
          const v = Math.round(between(225, 250));
          worn[k] = worn[k + 1] = worn[k + 2] = v;
        }
      }
      for (const table of tables) {
        const angle = between(-3, 3);
        const rotated = await sharp(worn, { raw: { width: w, height: h, channels: 4 } })
          .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer({ resolveWithObject: true });
        const W = Math.round(w * 1.3), H = Math.round(h * 1.24);
        const left = Math.round((W - rotated.info.width) / 2 + between(-10, 10));
        const top = Math.round((H - rotated.info.height) / 2 + between(-10, 10));
        const tint = Math.round(between(-8, 8));
        const photo = await sharp({ create: { width: W, height: H, channels: 3, background: { r: table.v + tint, g: table.v, b: table.v - tint } } })
          .composite([{ input: rotated.data, left, top }])
          .modulate({ brightness: between(0.75, 1.15) })
          .blur(between(0.4, 1.2))
          .jpeg({ quality: Math.round(between(60, 85)) })
          .toBuffer();
        const gray = await grayOf(sharp(photo));
        // Zielrahmen: dort, wo die Karte ungefähr liegt (die App kennt nur den Rahmen, nicht die Karte)
        const cx = left + rotated.info.width / 2, cy = top + rotated.info.height / 2;
        const jitter = h * 0.03;
        const expected = { x: cx - w / 2 + between(-jitter, jitter), y: cy - h / 2 + between(-jitter, jitter), width: w, height: h };
        const est = estimateCondition(gray, expected, ref);
        const key = `${level.name}|${table.name}`;
        const m = results.get(key) ?? new Map<string, number>();
        const outcome = est.condition ?? 'keine';
        m.set(outcome, (m.get(outcome) ?? 0) + 1);
        results.set(key, m);
        if (est.condition) metrics.set(key, [...(metrics.get(key) ?? []), [est.edge, est.corner]]);
        if (!est.condition && level.specks === 0 && table.v === 110) console.log(`  keine Schätzung (${p.printingId}): ${est.reason}`);
      }
    }
  }
  console.log(`\n=== Zustand: ${rows.length} Karten × ${levels.length} Abnutzungsstufen × ${tables.length} Unterlagen`);
  for (const table of tables) {
    for (const level of levels) {
      const key = `${level.name}|${table.name}`;
      const m = results.get(key)!;
      const dist = ['NM', 'LP', 'MP', 'HP', 'keine'].filter((c) => m.has(c)).map((c) => `${c} ${Math.round((100 * m.get(c)!) / rows.length)} %`).join(', ');
      const ms = metrics.get(key) ?? [];
      const med = (i: number) => (ms.length ? [...ms.map((x) => x[i])].sort((a, b) => a - b)[ms.length >> 1].toFixed(4) : '-');
      console.log(`${table.name.padEnd(11)} ${level.name.padEnd(7)} → ${dist}   (Median Kante ${med(0)}, Ecke ${med(1)})`);
    }
  }
}

async function grayOf(img: sharp.Sharp): Promise<Gray> {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return { data: Float32Array.from(data), width: info.width, height: info.height };
  return toGray({ data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: info.channels as 3 });
}

/**
 * Lernen aus eigenen Scans: n verzerrte Bilder gelten als „von dir bestätigt“.
 * Getestet wird mit neuen Verzerrungen, je zur Hälfte von schon gescannten und von neuen Drucken.
 */
async function evalLearning(file: CatalogFile, embeddings: Float32Array, embedder: Embedder, n: number) {
  const refs = Int32Array.from(file.refs, (r) => r.p);
  const imageOf = async (row: number) => {
    const { p, lang } = file.refs[row];
    const url = imageIn(file.printings[p], lang).imageUrl;
    return readFile(path.join('.cache/images', createHash('sha1').update(url).digest('hex')));
  };
  const rows = [...file.refs.keys()].sort(() => rand() - 0.5);
  const train = rows.slice(0, n);
  const trained = new Set(train.map((r) => refs[r]));
  const samples = [];
  for (const r of train) samples.push({ vector: await embedder.embed(await distort(await imageOf(r))), printing: refs[r] });
  const seenRows = train.slice(0, Math.min(150, n));
  const newRows = rows.slice(n).filter((r) => !trained.has(refs[r])).slice(0, 150);
  const test = [];
  for (const r of [...seenRows, ...newRows]) test.push({ vector: await embedder.embed(await distort(await imageOf(r))), printing: refs[r], seen: trained.has(refs[r]) });

  const variants: { name: string; source: SampleSource | null; config: typeof DEFAULT_LEARNING }[] = [
    { name: 'ohne Lernen', source: null, config: DEFAULT_LEARNING },
    { name: 'nur Kamera-Verschiebung', source: 'auto', config: DEFAULT_LEARNING },
    { name: 'nur eigene Fotos', source: 'user', config: { ...DEFAULT_LEARNING, minShiftSamples: Infinity } },
    { name: 'beides', source: 'user', config: DEFAULT_LEARNING },
    { name: 'beides, ohne Dämpfung', source: 'user', config: { ...DEFAULT_LEARNING, shrink: 0 } },
    { name: 'beides, ohne Abzug', source: 'user', config: { ...DEFAULT_LEARNING, samplePenalty: 0 } },
  ];
  console.log(`\n=== Lernen aus ${n} eigenen Scans (${trained.size} Drucke), Test: ${seenRows.length} schon gescannt / ${newRows.length} neu`);
  for (const v of variants) {
    const index = new AdaptiveIndex(embeddings, refs, file.meta.dim, v.config);
    if (v.source) index.setSamples(samples.map((s) => ({ ...s, source: v.source! })));
    const stat = { seen: { n: 0, hit: 0, conf: 0, confHit: 0 }, new: { n: 0, hit: 0, conf: 0, confHit: 0 } };
    for (const t of test) {
      const res = index.search(t.vector, 3);
      const st = t.seen ? stat.seen : stat.new;
      const hit = res[0]?.index === t.printing;
      const conf = res[0].score >= DEFAULT_STABILIZER.minScore && res[0].score - (res[1]?.score ?? 0) >= DEFAULT_STABILIZER.confidentMargin;
      st.n++;
      if (hit) st.hit++;
      if (conf) st.conf++;
      if (conf && hit) st.confHit++;
    }
    const fmt = (s: typeof stat.seen) =>
      `Top-1 ${((100 * s.hit) / s.n).toFixed(1)} %, sicher ${((100 * s.conf) / s.n).toFixed(1)} % (davon richtig ${((100 * s.confHit) / (s.conf || 1)).toFixed(1)} %)`;
    console.log(`${v.name.padEnd(24)} gescannt: ${fmt(stat.seen)} | neu: ${fmt(stat.new)}`);
  }
}

/**
 * Spracherkennung per OCR auf verzerrten Kartenbildern in voller Auflösung.
 * Französische Kartenbilder veröffentlicht Riot nicht, daher nur Englisch und Chinesisch.
 */
async function evalLanguage(file: CatalogFile, perLang: number, embeddings: Float32Array, embedder: Embedder) {
  const { createWorker } = await import('tesseract.js');
  const workers = { latin: await createWorker(OCR_MODELS.latin, 1), han: await createWorker(OCR_MODELS.han, 1) };
  const languages = file.meta.languages.map((l) => l.code);
  const index = new AdaptiveIndex(embeddings, Int32Array.from(file.refs, (r) => r.p), file.meta.dim);

  // Einzelne Karten gezielt prüfen (z. B. --card "Sprite Fountain")
  if (cardName) {
    for (const [i, p] of file.printings.entries()) {
      if (!p.cardName.toLowerCase().includes(cardName.toLowerCase())) continue;
      const rows = file.refs.flatMap((r, k) => (r.p === i ? [`${r.lang}#${k}`] : []));
      console.log(`\nKarte ${p.printingId} „${p.cardName}“ (${p.variant}, ${p.type}): Namen ${JSON.stringify(p.names ?? {})}, Referenzbilder ${rows.join(', ')}`);
      for (const [l, t] of Object.entries(p.texts ?? {})) console.log(`  Text ${l}: ${t.slice(0, 120)}`);
    }
  }

  for (const lang of ['en', 'zh-CN']) {
    let rows = [...file.refs.keys()].filter((r) => file.refs[r].lang === lang).sort(() => rand() - 0.5).slice(0, perLang);
    if (cardName) {
      const named = [...file.refs.keys()].filter((r) => file.refs[r].lang === lang && file.printings[file.refs[r].p].cardName.toLowerCase().includes(cardName.toLowerCase()));
      rows = [...named, ...rows];
    }
    const outcome = { ocr: new Map<string, number>(), image: new Map<string, number>(), combined: new Map<string, number>() };
    const count = (m: Map<string, number>, k: string | null) => m.set(k ?? 'unklar', (m.get(k ?? 'unklar') ?? 0) + 1);
    const margins: number[] = [];
    let ms = 0;
    let shown = 0;
    for (const r of rows) {
      const p = file.printings[file.refs[r].p];
      const full = new URL(imageIn(p, lang).imageUrl);
      full.searchParams.delete('w');
      full.searchParams.delete('fm');
      const res = await fetch(full.toString());
      if (!res.ok) continue;
      const original = Buffer.from(await res.arrayBuffer());
      const card = await (await distortTo(original, 1100)).png().toBuffer();
      const meta = await sharp(card).metadata();
      const region = await sharp(card)
        .extract({
          left: Math.round(meta.width! * TEXT_REGION.left),
          top: Math.round(meta.height! * TEXT_REGION.top),
          width: Math.round(meta.width! * (TEXT_REGION.right - TEXT_REGION.left)),
          height: Math.round(meta.height! * (TEXT_REGION.bottom - TEXT_REGION.top)),
        })
        .png()
        .toBuffer();
      // Sprache am Bild: wie in der App über das Embedding des Kamerabilds
      const small = await sharp(card).resize({ height: 320 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const vector = await embedder.embed({ data: new Uint8ClampedArray(small.data), width: small.info.width, height: small.info.height, channels: 3 });
      const scored = index.rowScores(vector, file.refs[r].p).map((x) => ({ lang: file.refs[x.row].lang, score: x.score }));
      const imageLang = languageFromImage(scored);
      if (scored.length > 1) {
        const own = Math.max(...scored.filter((x) => x.lang === lang).map((x) => x.score));
        const other = Math.max(...scored.filter((x) => x.lang !== lang).map((x) => x.score));
        margins.push(own - other);
      }
      const start = Date.now();
      const read: string[] = [];
      const reader = async (script: 'latin' | 'han') => {
        const text = (await workers[script].recognize(region)).data.text;
        read.push(`${script}: ${text.replace(/\s+/g, ' ').slice(0, 140)}`);
        return text;
      };
      const ocr = await detectLanguage(reader, p.texts ?? {}, languages);
      ms += Date.now() - start;
      // Wie in der App: Bild sagt Chinesisch → fertig; Bild sagt Latin → OCR nur unter Latin-Sprachen
      const combined =
        imageLang && isHanLanguage(imageLang)
          ? imageLang
          : imageLang
            ? (await detectLanguage(reader, p.texts ?? {}, languages.filter((l) => !isHanLanguage(l)))).lang
            : ocr.lang;
      count(outcome.ocr, ocr.lang);
      count(outcome.image, imageLang);
      count(outcome.combined, combined);
      const named = cardName && p.cardName.toLowerCase().includes(cardName.toLowerCase());
      if (named || (combined !== lang && shown++ < 3)) {
        console.log(`  [${lang}] ${p.printingId} ${p.cardName}: Bild ${imageLang ?? 'unklar'} ${JSON.stringify(scored.map((x) => [x.lang, +x.score.toFixed(3)]))}, OCR ${ocr.lang ?? 'unklar'} ${JSON.stringify(ocr.scores)}, zusammen ${combined ?? 'unklar'}\n    ${read.join('\n    ')}`);
      }
    }
    const fmt = (m: Map<string, number>) => [...m].map(([g, n]) => `${g} ${((100 * n) / rows.length).toFixed(0)} %`).join(', ');
    margins.sort((a, b) => a - b);
    const q = (f: number) => (margins.length ? margins[Math.floor(f * (margins.length - 1))].toFixed(3) : '-');
    console.log(`Sprache ${lang}: ${rows.length} Bilder (OCR im Schnitt ${Math.round(ms / rows.length)} ms)`);
    console.log(`  nur OCR:   ${fmt(outcome.ocr)}`);
    console.log(`  nur Bild:  ${fmt(outcome.image)}   (Vorsprung eigene Fassung: min ${q(0)}, 10 % ${q(0.1)}, Median ${q(0.5)}; ${margins.length} mit mehreren Bildern)`);
    console.log(`  zusammen:  ${fmt(outcome.combined)}`);
  }
  await workers.latin.terminate();
  await workers.han.terminate();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
