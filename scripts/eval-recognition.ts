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
import { averageMatches, DEFAULT_STABILIZER, isConfident } from '../src/core/stabilizer';
import type { Match } from '../src/core/matcher';
import { detectLanguage, languageFromImage, NO_LATIN_BELOW, TEXT_REGION, textViews } from '../src/core/language';
import { OCR_MODELS } from '../src/app/ocr';
import { AdaptiveIndex, DEFAULT_LEARNING, type SampleSource } from '../src/core/learning';
import type { Embedder } from '../src/core/embedder';
import { estimateCondition, toGray, type Gray } from '../src/core/condition';
import { CONDITIONS } from '../src/core/types';
import { compareReference } from './compare-ref';
import { FOIL_PIXEL, FOIL_SHARE, finishesOf, foilResidual, shimmerShare } from '../src/core/foil';
import type { Pixels } from '../src/core/imageops';
import { buildTextIndex, decide, latinMatch, matchText, textWinner, type TextMatch } from '../src/core/textmatch';
import { DEFAULT_SHADING, evenLighting, lightField, prepareForRecognition, SHADOW_EVEN, shadowStrength, type ShadingConfig } from '../src/core/shading';

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
const foilSamples = option('--foil', 60);
const textSamples = option('--text', 200);
const shadowSamples = option('--shadow', 200);
const cardName = args.includes('--card') ? args[args.indexOf('--card') + 1] : '';
/** Sprache wie in der App prüfen: Karten, deren Name oder Typ das enthält (z. B. "Battlefield"), plus Stichprobe. */
const langCheck = args.includes('--langcheck') ? args[args.indexOf('--langcheck') + 1] : '';

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
  return rawOf(await distortTo(buf, 320));
}

async function rawOf(img: sharp.Sharp): Promise<{ data: Uint8ClampedArray; width: number; height: number; channels: 3 }> {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 };
}

/** Weitere Kamera-Frames derselben Aufnahme: Hand wackelt etwas, Belichtung schwankt, neues Rauschen. */
async function nextFrame(frame: Buffer): Promise<sharp.Sharp> {
  const meta = await sharp(frame).metadata();
  const img = await sharp(frame)
    .rotate(between(-1.5, 1.5), { background: { r: 120, g: 120, b: 120 } })
    .modulate({ brightness: between(0.92, 1.08) })
    .blur(between(0.3, 0.9))
    .jpeg({ quality: Math.round(between(55, 85)) })
    .toBuffer();
  const m = await sharp(img).metadata();
  return sharp(img).extract({ left: Math.floor((m.width! - meta.width!) / 2), top: Math.floor((m.height! - meta.height!) / 2), width: meta.width!, height: meta.height! });
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
  // Entscheidung wie in der App: gemittelt über mehrere Frames, sicher → speichern, sonst nachfragen
  const MARGINS = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08];
  const FRAME_COUNTS = [1, 3];
  const decisions = new Map<string, { auto: number; autoRight: number; asked: number; askedInList: number }>();
  // (Abstand, richtig?) je Testbild, für die Kalibrierung Abstand → Wahrscheinlichkeit richtig
  const calibration = new Map<number, { margin: number; right: boolean }[]>();
  const decide = (key: string, frames: Match[][], truth: number) => {
    const avg = averageMatches(frames);
    const list = calibration.get(frames.length) ?? [];
    list.push({ margin: avg[0].score - (avg[1]?.score ?? 0), right: avg[0].index === truth });
    calibration.set(frames.length, list);
    for (const margin of MARGINS) {
      const k = `${key}|${margin}`;
      const d = decisions.get(k) ?? { auto: 0, autoRight: 0, asked: 0, askedInList: 0 };
      if (isConfident(avg, { minScore: DEFAULT_STABILIZER.minScore, confidentMargin: margin })) {
        d.auto++;
        if (avg[0].index === truth) d.autoRight++;
      } else {
        d.asked++;
        if (avg.slice(0, DEFAULT_STABILIZER.candidates).some((m) => m.index === truth)) d.askedInList++;
      }
      decisions.set(k, d);
    }
  };
  const perLang = new Map<string, { n: number; hit: number }>();
  const misses: string[] = [];
  for (const r of rowIdx) {
    const { p: i, lang } = file.refs[r];
    const p = file.printings[i];
    const url = imageIn(p, lang).imageUrl;
    const cached = path.join('.cache/images', createHash('sha1').update(url).digest('hex'));
    const base = await (await distortTo(await readFile(cached), 320)).jpeg({ quality: 90 }).toBuffer();
    const frames: Match[][] = [];
    for (let f = 0; f < Math.max(...FRAME_COUNTS); f++) {
      const q = await embedder.embed(await rawOf(f === 0 ? sharp(base) : await nextFrame(base)));
      frames.push(collapseToPrintings(topK(q, embeddings, file.meta.dim, 24), (row) => file.refs[row].p, 8));
    }
    for (const n of FRAME_COUNTS) decide(`${n}`, frames.slice(0, n), i);
    const res = frames[0].slice(0, 3);
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
  console.log(`\n=== Speichern oder nachfragen (Abstand Platz 1 zu 2, aktuell ${DEFAULT_STABILIZER.confidentMargin}; Nachfrage zeigt ${DEFAULT_STABILIZER.candidates} Kandidaten)`);
  for (const n of FRAME_COUNTS) {
    for (const margin of MARGINS) {
      const d = decisions.get(`${n}|${margin}`)!;
      console.log(
        `${n} Frame(s), Abstand ${margin.toFixed(2)}: automatisch gespeichert ${pct(d.auto)}, davon richtig ${pct(d.autoRight, d.auto || 1)} · nachgefragt ${pct(d.asked)}, richtige Karte unter den Vorschlägen ${pct(d.askedInList, d.asked || 1)}`,
      );
    }
  }
  // Kalibrierung: Anteil richtiger Treffer je Abstandsbereich, mit unterer 95-%-Schranke (Wilson)
  const wilson = (k: number, n: number) => {
    if (!n) return 0;
    const z = 1.96, p = k / n;
    return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  };
  const EDGES = [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06, 0.08, 1];
  for (const [n, list] of calibration) {
    console.log(`\n=== Kalibrierung (${n} Frame(s)): Abstand → richtig (untere 95-%-Schranke) · ab diesem Abstand insgesamt`);
    for (let b = 0; b + 1 < EDGES.length; b++) {
      const inBin = list.filter((x) => x.margin >= EDGES[b] && x.margin < EDGES[b + 1]);
      const above = list.filter((x) => x.margin >= EDGES[b]);
      const k = inBin.filter((x) => x.right).length, ka = above.filter((x) => x.right).length;
      console.log(
        `  ${EDGES[b].toFixed(3)}–${EDGES[b + 1] < 1 ? EDGES[b + 1].toFixed(3) : '…'}: ${k}/${inBin.length} richtig (${inBin.length ? ((100 * k) / inBin.length).toFixed(1) : '-'} %, ≥ ${(100 * wilson(k, inBin.length)).toFixed(1)} %) · ab hier ${ka}/${above.length} (≥ ${(100 * wilson(ka, above.length)).toFixed(1)} %)`,
      );
    }
  }
  if (shadowSamples) await evalShadow(file, shadowSamples, embeddings, embedder);
  if (conditionSamples) await evalCondition(file, conditionSamples);
  if (foilSamples) await evalFoil(file, foilSamples);
  if (learnSamples) await evalLearning(file, embeddings, embedder, learnSamples);
  if (textSamples) await evalText(file, textSamples, embeddings, embedder);
  if (ocrSamples || cardName) await evalLanguage(file, ocrSamples, embeddings, embedder);
  if (langCheck) await evalAppLanguage(file, langCheck, Math.max(ocrSamples, 20));
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
    { name: 'sauber + Schatten', specks: 0, shadow: true },
    { name: 'mittel + Schatten', specks: 35, shadow: true },
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
    const ref = await grayOf(compareReference(buf));
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
        let shot = sharp(photo);
        if ('shadow' in level) {
          const { data, info } = await shot.raw().toBuffer({ resolveWithObject: true });
          addShadow(data, info.width, info.height, info.channels);
          shot = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
        }
        const gray = await grayOf(shot);
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
      const dist = [...CONDITIONS, 'keine'].filter((c) => m.has(c)).map((c) => `${c} ${Math.round((100 * m.get(c)!) / rows.length)} %`).join(', ');
      const ms = metrics.get(key) ?? [];
      const med = (i: number) => (ms.length ? [...ms.map((x) => x[i])].sort((a, b) => a - b)[ms.length >> 1].toFixed(4) : '-');
      console.log(`${table.name.padEnd(11)} ${level.name.padEnd(17)} → ${dist}   (Median Kante ${med(0)}, Ecke ${med(1)})`);
    }
  }
}

/**
 * Foil-Erkennung: Referenzbilder mit künstlichem Regenbogenschimmer verschiedener Stärke, ohne Schimmer
 * und ohne Schimmer, aber mit weißer Spiegelung (Hülle), als Handyfoto auf grauer Unterlage.
 * Misst Fehlalarme bei normalen Karten; wie stark echter Foil-Schimmer im Foto ist, zeigt erst ein echter Scan.
 */
async function evalFoil(file: CatalogFile, n: number) {
  const byRarity = new Map<string, number>();
  for (const p of file.printings) {
    const key = `${p.rarity ?? '?'} / ${p.variant} → ${finishesOf(p).join('+')}`;
    byRarity.set(key, (byRarity.get(key) ?? 0) + 1);
  }
  console.log(`\n=== Ausführungen laut Katalog (Seltenheit / Variante → mögliche Ausführungen)`);
  for (const [k, v] of [...byRarity].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  const rows = [...file.refs.keys()].filter((r) => file.refs[r].lang === 'en').sort(() => rand() - 0.5).slice(0, n);
  const cases = [
    { name: 'normal', foil: 0, glare: false },
    { name: 'normal + Spiegelung', foil: 0, glare: true },
    { name: 'Foil schwach (8 %)', foil: 0.08, glare: false },
    { name: 'Foil mittel (15 %)', foil: 0.15, glare: false },
    { name: 'Foil stark (25 %)', foil: 0.25, glare: false },
    { name: 'normal + Schatten', foil: 0, glare: false, shadow: true },
    { name: 'Foil mittel + Schatten', foil: 0.15, glare: false, shadow: true },
  ];
  const PIXEL_THRESHOLDS = [0.03, FOIL_PIXEL, 0.04];
  // Fall → je Pixelschwelle die Anteile schimmernder Pixel
  const scores = new Map<string, number[][]>();
  const skipped = new Map<string, number>();
  for (const r of rows) {
    const p = file.printings[file.refs[r].p];
    const buf = await readFile(path.join('.cache/images', createHash('sha1').update(p.imageUrl).digest('hex')));
    const refImg = await compareReference(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ref: Pixels = { data: refImg.data, width: refImg.info.width, height: refImg.info.height, channels: 3 };
    const refGray = toGray(ref);
    const { data: card, info } = await sharp(buf).resize({ height: 670 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const radius = (3 / 63) * w;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const cx = Math.min(Math.max(x + 0.5, radius), w - radius), cy = Math.min(Math.max(y + 0.5, radius), h - radius);
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) card[(y * w + x) * 4 + 3] = 0;
    }
    for (const c of cases) {
      const img = Buffer.from(card);
      const phase = rand() * 6, fx = between(1.5, 4), fy = between(1, 3);
      const gx = between(0.2, 0.8) * w, gy = between(0.2, 0.8) * h, gr = between(0.15, 0.35) * w;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        if (!img[k + 3]) continue;
        if (c.foil) {
          const t = ((x / w) * fx + (y / h) * fy) * Math.PI * 2 + phase + (rand() - 0.5) * 1.5;
          for (let i = 0; i < 3; i++) img[k + i] = Math.max(0, Math.min(255, img[k + i] + c.foil * 127 * Math.sin(t + i * 2.1)));
        }
        if (c.glare) {
          const a = 0.55 * Math.max(0, 1 - Math.hypot(x - gx, y - gy) / gr);
          for (let i = 0; i < 3; i++) img[k + i] = img[k + i] * (1 - a) + 250 * a;
        }
      }
      const rotated = await sharp(img, { raw: { width: w, height: h, channels: 4 } })
        .rotate(between(-3, 3), { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer({ resolveWithObject: true });
      const W = Math.round(w * 1.3), H = Math.round(h * 1.24);
      const left = Math.round((W - rotated.info.width) / 2 + between(-10, 10));
      const top = Math.round((H - rotated.info.height) / 2 + between(-10, 10));
      const tint = between(-0.08, 0.08);
      const photoImg = await sharp(
        await sharp({ create: { width: W, height: H, channels: 3, background: { r: 110, g: 112, b: 115 } } })
          .composite([{ input: rotated.data, left, top }])
          .linear([1 + tint, 1, 1 - tint], [0, 0, 0])
          .modulate({ brightness: between(0.75, 1.15), saturation: between(0.9, 1.35), hue: Math.round(between(-6, 6)) })
          .blur(between(0.4, 1.2))
          .jpeg({ quality: Math.round(between(60, 85)) })
          .toBuffer(),
      ).raw().toBuffer({ resolveWithObject: true });
      if ('shadow' in c) addShadow(photoImg.data, photoImg.info.width, photoImg.info.height, photoImg.info.channels);
      const photo: Pixels = { data: photoImg.data, width: photoImg.info.width, height: photoImg.info.height, channels: photoImg.info.channels as 3 };
      const cx = left + rotated.info.width / 2, cy = top + rotated.info.height / 2;
      const jitter = h * 0.03;
      const expected = { x: cx - w / 2 + between(-jitter, jitter), y: cy - h / 2 + between(-jitter, jitter), width: w, height: h };
      const cond = estimateCondition(toGray(photo), expected, refGray);
      if (!cond.quad || cond.fit < 0.6) {
        skipped.set(c.name, (skipped.get(c.name) ?? 0) + 1);
        continue;
      }
      const residual = foilResidual(photo, cond.quad, ref);
      if (!residual) continue;
      scores.set(c.name, [...(scores.get(c.name) ?? []), PIXEL_THRESHOLDS.map((t) => shimmerShare(residual, t))]);
    }
  }
  console.log(`\n=== Foil: ${rows.length} Karten × ${cases.length} Fälle, aktuell Pixelschwelle ${FOIL_PIXEL}, Anteil ${Math.round(FOIL_SHARE * 100)} %`);
  PIXEL_THRESHOLDS.forEach((t, ti) => {
    console.log(`Pixelschwelle ${t}:`);
    for (const c of cases) {
      const s = (scores.get(c.name) ?? []).map((x) => x[ti]).sort((a, b) => a - b);
      if (!s.length) continue;
      const q = (f: number) => `${(s[Math.min(s.length - 1, Math.floor(f * s.length))] * 100).toFixed(1)} %`;
      const foil = s.filter((x) => x >= FOIL_SHARE).length;
      console.log(`  ${c.name.padEnd(22)} → Foil ${Math.round((100 * foil) / s.length)} %   Schimmer-Quantile 10/50/90/99 %: ${q(0.1)}, ${q(0.5)}, ${q(0.9)}, ${q(0.99)}   (${skipped.get(c.name) ?? 0} ohne Aussage)`);
    }
  });
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
      // Wie in der App: erst der gelesene Text, nur wenn der unklar ist, das Bild
      const combined = ocr.lang ?? imageLang;
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

/** Ganzes Kartenbild in voller Auflösung (für OCR), wie es Riot veröffentlicht. */
async function fullImage(p: CatalogFile['printings'][number], lang: string): Promise<Buffer | null> {
  const full = new URL(imageIn(p, lang).imageUrl);
  full.searchParams.delete('w');
  full.searchParams.delete('fm');
  const res = await fetch(full.toString()).catch(() => null);
  return res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

async function textRegion(card: Buffer): Promise<Buffer> {
  return regionOf(card, TEXT_REGION);
}

async function regionOf(card: Buffer, region: typeof TEXT_REGION): Promise<Buffer> {
  const meta = await sharp(card).metadata();
  return sharp(card)
    .extract({
      left: Math.round(meta.width! * region.left),
      top: Math.round(meta.height! * region.top),
      width: Math.round(meta.width! * (region.right - region.left)),
      height: Math.round(meta.height! * (region.bottom - region.top)),
    })
    .png()
    .toBuffer();
}

/**
 * Karte am Text erkennen: Bild (3 Frames gemittelt, wie in der App) und OCR des Textfelds zusammen.
 * Vergleicht „nur Bild“ (bisher) mit „Bild + Text“ und sucht die Schwellen für den Text.
 */
async function evalText(file: CatalogFile, n: number, embeddings: Float32Array, embedder: Embedder) {
  const { createWorker } = await import('tesseract.js');
  const workers = { latin: await createWorker(OCR_MODELS.latin, 1), han: await createWorker(OCR_MODELS.han, 1) };
  const index = buildTextIndex(file.printings);
  const hasHan = file.meta.languages.some((l) => l.code.startsWith('zh'));
  const variants = index.groups.filter((g) => g.members.length > 1).length;
  console.log(`\n=== Erkennung mit Text: ${n} Testbilder, ${index.groups.length} verschiedene Kartentexte (${variants} davon mit mehreren Drucken)`);
  // Halb englische, halb chinesische Kartenbilder (französische veröffentlicht Riot nicht)
  const shuffled = [...file.refs.keys()].sort(() => rand() - 0.5);
  const en = shuffled.filter((r) => file.refs[r].lang === 'en');
  const zh = shuffled.filter((r) => file.refs[r].lang.startsWith('zh'));
  const rows = en.flatMap((r, i) => (zh[i] === undefined ? [r] : [r, zh[i]]));
  const languages = file.meta.languages.map((l) => l.code);
  const lang = { ok: new Map<string, { n: number; right: number; slowRight: number; noLatin: number; unclear: number }>(), match: new Map<string, number[]>() };
  const K = DEFAULT_STABILIZER.candidates;
  type Outcome = { auto: number; autoRight: number; asked: number; askedInList: number };
  const blank = (): Outcome => ({ auto: 0, autoRight: 0, asked: 0, askedInList: 0 });
  const imageOnly = blank(), combined = blank();
  const asks = { unsure: 0, variant: 0, conflict: 0 };
  const via = { image: { n: 0, right: 0 }, text: { n: 0, right: 0 }, number: { n: 0, right: 0 }, textOutsideImage: { n: 0, right: 0 }, conflict: { n: 0, imageWasRight: 0, textWasRight: 0 } };
  const sweep: { t1: number; t2: number; right: boolean }[] = [];
  let numberRead = 0, numberRight = 0, done = 0, ms = 0, hanReads = 0;
  const failures: string[] = [];
  for (const r of rows) {
    if (done >= n) break;
    const { p: truth, lang: truthLang } = file.refs[r];
    const lang_ = truthLang;
    const p = file.printings[truth];
    const original = await fullImage(p, lang_);
    if (!original) continue;
    done++;
    const card = await (await distortTo(original, 1100)).png().toBuffer();
    const base = await sharp(card).resize({ height: 320 }).jpeg({ quality: 90 }).toBuffer();
    const frames: Match[][] = [];
    for (let f = 0; f < 3; f++) {
      const q = await embedder.embed(await rawOf(f === 0 ? sharp(base) : await nextFrame(base)));
      frames.push(collapseToPrintings(topK(q, embeddings, file.meta.dim, 24), (row) => file.refs[row].p, 8));
    }
    const avg = averageMatches(frames);
    const confident = isConfident(avg, DEFAULT_STABILIZER);
    const count = (o: Outcome, d: { action: 'save'; index: number } | { action: 'ask'; candidates: number[] }) => {
      if (d.action === 'save') {
        o.auto++;
        if (d.index === truth) o.autoRight++;
      } else {
        o.asked++;
        if (d.candidates.includes(truth)) o.askedInList++;
      }
    };
    count(imageOnly, confident ? { action: 'save', index: avg[0].index } : { action: 'ask', candidates: avg.slice(0, K).map((m) => m.index) });

    // Text: erst Latin; Han nur, wenn das nicht eindeutig ist (wie in der App)
    const region = await textRegion(card);
    const start = Date.now();
    const latin = (await workers.latin.recognize(region)).data.text;
    let text: TextMatch = matchText(index, { latin });
    let han = '';
    if (hasHan && !confident && !textWinner(text)) {
      han = (await workers.han.recognize(region)).data.text;
      hanReads++;
      text = matchText(index, { latin, han });
    }
    ms += Date.now() - start;

    // Sprache wie in der App (Karte als bekannt angenommen): mit chinesischer Texterkennung, und wie auf einem
    // langsamen Handy ohne (Zeitüberschreitung), dann nur mit der Regel „kein englischer Text“
    const hanText = async () => han || (han = (await workers.han.recognize(region)).data.text);
    const match = (t: string) => latinMatch(index, truth, t);
    const opts = { match, noLatinBelow: NO_LATIN_BELOW, name: p.cardName };
    const full = await detectLanguage(async (sc) => (sc === 'latin' ? latin : hanText()), p.texts ?? {}, languages, undefined, opts);
    const slow = await detectLanguage(async (sc) => (sc === 'latin' ? latin : ''), p.texts ?? {}, languages, undefined, opts);
    const key = truthLang.startsWith('zh') ? 'zh' : 'en';
    const st = lang.ok.get(key) ?? { n: 0, right: 0, slowRight: 0, noLatin: 0, unclear: 0 };
    st.n++;
    if (full.lang === truthLang) st.right++;
    if (slow.lang === truthLang) st.slowRight++;
    if (full.reason === 'no-latin') st.noLatin++;
    if (!full.lang) st.unclear++;
    lang.ok.set(key, st);
    lang.match.set(key, [...(lang.match.get(key) ?? []), match(latin)]);
    const [a, b] = text.ranked;
    if (a) sweep.push({ t1: a.score, t2: b?.score ?? 0, right: index.groups[a.group].members.includes(truth) });
    if (text.collector) {
      numberRead++;
      if (text.collector === index.collectorNumbers[truth]) numberRight++;
    }
    const d = decide(index, avg, confident, text, K);
    count(combined, d);
    if (d.action === 'save') {
      const right = d.index === truth;
      via[d.via].n++;
      if (right) via[d.via].right++;
      if (d.via === 'text' && !avg.some((m) => m.index === d.index)) {
        via.textOutsideImage.n++;
        if (right) via.textOutsideImage.right++;
      }
      if (!right && failures.length < 12) {
        const got = file.printings[d.index];
        failures.push(`[${truthLang}] ${p.printingId} „${p.cardName}“ (${p.variant}) → ${got.printingId} „${got.cardName}“ (${got.variant}) per ${d.via}, Text ${a?.score.toFixed(2)}/${b?.score.toFixed(2) ?? '-'}, Bild ${avg[0].score.toFixed(3)}-${avg[1]?.score.toFixed(3)}\n      OCR: ${(latin + ' ' + han).replace(/\s+/g, ' ').slice(0, 160)}`);
      }
    }
    if (d.action === 'ask') asks[d.reason]++;
    if (d.action === 'ask' && d.reason === 'conflict') {
      via.conflict.n++;
      if (avg[0].index === truth) via.conflict.imageWasRight++;
      if (a && index.groups[a.group].members.includes(truth)) via.conflict.textWasRight++;
    }
  }
  await workers.latin.terminate();
  await workers.han.terminate();

  const pct = (k: number, d: number) => (d ? `${((100 * k) / d).toFixed(1)} %` : '-');
  const wilson = (k: number, m: number) => {
    if (!m) return 0;
    const z = 1.96, q = k / m;
    return (q + (z * z) / (2 * m) - z * Math.sqrt((q * (1 - q)) / m + (z * z) / (4 * m * m))) / (1 + (z * z) / m);
  };
  const line = (name: string, o: Outcome) =>
    console.log(`  ${name}: ohne Nachfrage gespeichert ${pct(o.auto, done)}, davon richtig ${pct(o.autoRight, o.auto)} (≥ ${(100 * wilson(o.autoRight, o.auto)).toFixed(1)} %) · nachgefragt ${pct(o.asked, done)}, richtige Karte unter den Vorschlägen ${pct(o.askedInList, o.asked)}`);
  console.log(`OCR im Schnitt ${Math.round(ms / Math.max(1, done))} ms, chinesisch nachgelesen bei ${hanReads}`);
  line('nur Bild   ', imageOnly);
  line('Bild + Text', combined);
  console.log(`  davon per Bild ${via.image.right}/${via.image.n} richtig, per Text ${via.text.right}/${via.text.n} richtig, per Sammlernummer ${via.number.right}/${via.number.n} richtig (Karte nicht unter den Bildtreffern: ${via.textOutsideImage.right}/${via.textOutsideImage.n})`);
  console.log(`  Widerspruch Bild sicher ↔ Text eindeutig, daher nachgefragt: ${via.conflict.n} (Bild hatte recht: ${via.conflict.imageWasRight}, Text hatte recht: ${via.conflict.textWasRight})`);
  console.log(`  Nachgefragt, weil: Bild knapp und Text unklar ${asks.unsure}, Variante unklar ${asks.variant}, Widerspruch ${asks.conflict}`);
  console.log(`  Sammlernummer gelesen: ${numberRead}, davon richtig ${numberRight}`);
  if (failures.length) console.log(`  Fehler:\n    ${failures.join('\n    ')}`);
  console.log(`\n  Sprache (Regel „kein englischer Text“ ab ${NO_LATIN_BELOW}):`);
  for (const [k, st] of lang.ok) {
    console.log(`    ${k}: ${st.n} Bilder, richtig ${pct(st.right, st.n)} (davon per Regel ${st.noLatin}, unklar ${st.unclear}) · ohne chinesische Texterkennung richtig ${pct(st.slowRight, st.n)}`);
  }
  const q = (list: number[], f: number) => [...list].sort((x, y) => x - y)[Math.floor(f * (list.length - 1))]?.toFixed(3) ?? '-';
  for (const [k, list] of lang.match) console.log(`    Passung lateinischer Text ↔ englische Karte, ${k}: 5 % ${q(list, 0.05)}, 10 % ${q(list, 0.1)}, Median ${q(list, 0.5)}, 90 % ${q(list, 0.9)}, 95 % ${q(list, 0.95)}`);
  for (const t of [0.03, 0.05, 0.08, 0.12, 0.16, 0.2]) {
    const enList = lang.match.get('en') ?? [], zhList = lang.match.get('zh') ?? [];
    console.log(`    Schwelle ${t}: EN darunter ${enList.filter((x) => x < t).length}/${enList.length}, ZH darunter ${zhList.filter((x) => x < t).length}/${zhList.length}`);
  }
  console.log(`\n  Textschwellen (beste Gruppe richtig, untere 95-%-Schranke) · Anteil eindeutig:`);
  for (const minScore of [0.15, 0.2, 0.25, 0.3, 0.35, 0.45]) {
    const cells = [0.05, 0.1, 0.15, 0.2, 0.3].map((minMargin) => {
      const sel = sweep.filter((x) => x.t1 >= minScore && x.t1 - x.t2 >= minMargin);
      const k = sel.filter((x) => x.right).length;
      return `Abstand ${minMargin}: ${k}/${sel.length} (≥ ${(100 * wilson(k, sel.length)).toFixed(0)} %) ${pct(sel.length, done)}`;
    });
    console.log(`    ab ${minScore}: ${cells.join(' | ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Schatten des Handys auf der Karte, direkt ins Bild gerechnet (RGB oder RGBA, verändert data).
 * Entweder eine weiche Schattenkante quer über die Karte oder der Umriss des Handys (abgerundetes
 * Rechteck, größer als die Karte, weil das Handy über ihr schwebt), der die Karte teilweise bedeckt.
 * Im Schatten bleibt 35–75 % des Lichts, leicht bläulich (Licht von Fenster und Raum).
 */
function addShadow(data: Uint8Array | Uint8ClampedArray | Buffer, w: number, h: number, channels: number) {
  const keep = between(0.35, 0.75);
  const soft = between(0.03, 0.15) * h;
  const smooth = (t: number) => (t <= -1 ? 0 : t >= 1 ? 1 : 0.5 + 0.5 * Math.sin((t * Math.PI) / 2));
  let mask: (x: number, y: number) => number;
  if (rand() < 0.55) {
    // Schattenkante: Richtung beliebig, bedeckt 20–70 % der Karte
    const a = rand() * Math.PI * 2, nx = Math.cos(a), ny = Math.sin(a);
    const proj = (x: number, y: number) => (x - w / 2) * nx + (y - h / 2) * ny;
    const extent = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
    const cut = extent * (1 - 2 * between(0.2, 0.7));
    mask = (x, y) => smooth((proj(x, y) - cut) / soft);
  } else {
    // Handy-Umriss: 0,8–1,1 × Kartenbreite breit, 1,3–1,8 × Kartenhöhe hoch, seitlich oder nach oben/unten versetzt
    const rw = between(0.8, 1.1) * w / 2, rh = between(1.3, 1.8) * h / 2, radius = 0.15 * w;
    const a = rand() * Math.PI * 2, shift = between(0.45, 0.85);
    const cx = w / 2 + Math.cos(a) * shift * (rw + w / 2), cy = h / 2 + Math.sin(a) * shift * (rh + h / 2);
    mask = (x, y) => {
      const dx = Math.max(0, Math.abs(x - cx) - (rw - radius)), dy = Math.max(0, Math.abs(y - cy) - (rh - radius));
      return smooth((Math.hypot(dx, dy) - radius) / -soft);
    };
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = mask(x + 0.5, y + 0.5);
    if (!m) continue;
    const f = 1 - (1 - keep) * m;
    const k = (y * w + x) * channels;
    data[k] = Math.round(data[k] * f * (1 - 0.04 * m));
    data[k + 1] = Math.round(data[k + 1] * f);
    data[k + 2] = Math.min(255, Math.round(data[k + 2] * f * (1 + 0.04 * m)));
  }
}

/**
 * Handyschatten: dieselben verzerrten Karten mit und ohne Schatten, erkannt ohne Ausgleich, mit Ausgleich
 * nur im Kamerabild und mit Ausgleich in Kamerabild und Katalog (dafür wird der Katalog hier neu berechnet).
 * Entscheidung wie in der App aus 3 Frames; dazu Kalibrierung Abstand → richtig für die 95-%-Regel.
 */
async function evalShadow(file: CatalogFile, n: number, embeddings: Float32Array, embedder: Embedder) {
  const refRows = file.refs.map((r) => r.p);
  const imageOfRow = (row: number) => {
    const { p, lang } = file.refs[row];
    return readFile(path.join('.cache/images', createHash('sha1').update(imageIn(file.printings[p], lang).imageUrl).digest('hex')));
  };
  const configs: { name: string; config: ShadingConfig }[] = [{ name: 'Raster 8, Nachbarn 2', config: DEFAULT_SHADING }];
  // Katalog mit Ausgleich (wie ein neu gebauter Katalog)
  const evened: Float32Array[] = [];
  for (const { name, config } of configs) {
    const started = Date.now();
    const out = new Float32Array(embeddings.length);
    for (let row = 0; row < file.refs.length; row++) {
      const { data, info } = await sharp(await imageOfRow(row)).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
      const px: Pixels = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 };
      out.set(await embedder.embed(evenLighting(px, config)), row * file.meta.dim);
    }
    evened.push(out);
    console.log(`Katalog mit Ausgleich (${name}): ${file.refs.length} Bilder in ${Math.round((Date.now() - started) / 1000)} s`);
  }
  const variants = [
    { name: 'ohne Ausgleich', prep: (p: Pixels) => p, catalog: embeddings },
    ...configs.map((c) => ({ name: `immer, nur Kamera (${c.name})`, prep: (p: Pixels) => evenLighting(p, c.config), catalog: embeddings })),
    // Wie in der App: nur ausgleichen, wenn das Bild deutlich ungleichmäßig beleuchtet ist
    { name: `App (ab Stärke ${SHADOW_EVEN})`, prep: (p: Pixels) => prepareForRecognition(p).pixels, catalog: embeddings },
    ...configs.map((c, i) => ({ name: `Kamera + Katalog (${c.name})`, prep: (p: Pixels) => evenLighting(p, c.config), catalog: evened[i] })),
  ];
  const scenes = ['ohne Schatten', 'mit Schatten'];
  type Stat = { n: number; top1: number; auto: number; autoRight: number; margins: { margin: number; right: boolean }[] };
  const stats = new Map<string, Stat>();
  const strength = new Map<string, number[]>();
  const rows = [...file.refs.keys()].sort(() => rand() - 0.5).slice(0, n);
  for (const row of rows) {
    const truth = file.refs[row].p;
    const base = await (await distortTo(await imageOfRow(row), 320)).jpeg({ quality: 90 }).toBuffer();
    for (const scene of scenes) {
      let shot = base;
      if (scene === 'mit Schatten') {
        const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
        addShadow(data, info.width, info.height, info.channels);
        shot = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 90 }).toBuffer();
      }
      const frames: Pixels[] = [];
      for (let f = 0; f < 3; f++) frames.push(await rawOf(f === 0 ? sharp(shot) : await nextFrame(shot)));
      strength.set(scene, [...(strength.get(scene) ?? []), shadowStrength(lightField(frames[0]))]);
      for (const v of variants) {
        const matches: Match[][] = [];
        for (const fr of frames) {
          const q = await embedder.embed(v.prep(fr));
          matches.push(collapseToPrintings(topK(q, v.catalog, file.meta.dim, 24), (r) => refRows[r], 8));
        }
        const avg = averageMatches(matches);
        const key = `${scene}|${v.name}`;
        const st = stats.get(key) ?? { n: 0, top1: 0, auto: 0, autoRight: 0, margins: [] };
        st.n++;
        if (matches[0][0]?.index === truth) st.top1++;
        const right = avg[0]?.index === truth;
        if (isConfident(avg, { minScore: DEFAULT_STABILIZER.minScore, confidentMargin: DEFAULT_STABILIZER.confidentMargin })) {
          st.auto++;
          if (right) st.autoRight++;
        }
        st.margins.push({ margin: avg[0].score - (avg[1]?.score ?? 0), right });
        stats.set(key, st);
      }
    }
  }
  const wilson = (k: number, m: number) => {
    if (!m) return 0;
    const z = 1.96, p = k / m;
    return (p + (z * z) / (2 * m) - z * Math.sqrt((p * (1 - p)) / m + (z * z) / (4 * m * m))) / (1 + (z * z) / m);
  };
  const pct = (k: number, m: number) => `${m ? ((100 * k) / m).toFixed(1) : '-'} %`;
  console.log(`\n=== Handyschatten: ${rows.length} Karten, je ohne und mit Schatten, 3 Frames, Abstand ${DEFAULT_STABILIZER.confidentMargin}`);
  for (const scene of scenes) {
    console.log(`${scene}:`);
    for (const v of variants) {
      const st = stats.get(`${scene}|${v.name}`)!;
      // Für die 95-%-Regel: richtig ab dem Speicher-Abstand, und im schwächsten Bereich direkt darüber
      const near = st.margins.filter((m) => m.margin >= DEFAULT_STABILIZER.confidentMargin && m.margin < DEFAULT_STABILIZER.confidentMargin + 0.02);
      const nearRight = near.filter((m) => m.right).length;
      console.log(
        `  ${v.name.padEnd(30)} Top-1 ${pct(st.top1, st.n)} · automatisch ${pct(st.auto, st.n)}, davon richtig ${pct(st.autoRight, st.auto)} (≥ ${(100 * wilson(st.autoRight, st.auto)).toFixed(1)} %) · Abstand ${DEFAULT_STABILIZER.confidentMargin}–${DEFAULT_STABILIZER.confidentMargin + 0.02}: ${nearRight}/${near.length}`,
      );
    }
  }
  // Kalibrierung über beide Szenen für die Varianten mit Ausgleich (Abstand → richtig)
  const EDGES = [0, 0.02, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1, 1];
  for (const v of variants) {
    const all = scenes.flatMap((s) => stats.get(`${s}|${v.name}`)!.margins);
    const cells = [];
    for (let b = 0; b + 1 < EDGES.length; b++) {
      const bin = all.filter((m) => m.margin >= EDGES[b] && m.margin < EDGES[b + 1]);
      const k = bin.filter((m) => m.right).length;
      cells.push(`${EDGES[b].toFixed(2)}+: ${k}/${bin.length} (≥ ${(100 * wilson(k, bin.length)).toFixed(0)} %)`);
    }
    console.log(`  Kalibrierung ${v.name}: ${cells.join(' | ')}`);
  }
  console.log('Schattenstärke (dunkelste 10 % zu hellsten 10 %), Quantile 10/50/90/95/99 %:');
  for (const scene of scenes) {
    const s = [...strength.get(scene)!].sort((a, b) => a - b);
    const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))].toFixed(2);
    console.log(`  ${scene.padEnd(14)} ${q(0.1)}, ${q(0.5)}, ${q(0.9)}, ${q(0.95)}, ${q(0.99)}`);
  }
}

/**
 * Spracherkennung wie in der App, mit dem Kamerabild statt des Originals: Querformat-Karten (Battlefields)
 * liegen hochkant im Zielrahmen, also um 90° gedreht (beide Richtungen). Geprüft werden die genannten
 * Karten (Name oder Typ enthält `names`, mehrere mit „|“) und eine Stichprobe englischer und chinesischer Drucke.
 * Je Bild: mit chinesischer Texterkennung und wie auf einem langsamen Handy ohne (Zeitüberschreitung).
 */
async function evalAppLanguage(file: CatalogFile, names: string, perLang: number) {
  const { createWorker } = await import('tesseract.js');
  const workers = { latin: await createWorker(OCR_MODELS.latin, 1), han: await createWorker(OCR_MODELS.han, 1) };
  const index = buildTextIndex(file.printings);
  const languages = file.meta.languages.map((l) => l.code);
  const wanted = names.toLowerCase().split('|').map((n) => n.trim()).filter(Boolean);
  const isWanted = (p: CatalogFile['printings'][number]) => wanted.some((n) => p.cardName.toLowerCase().includes(n) || (p.type ?? '').toLowerCase().includes(n));
  const shuffled = [...file.refs.keys()].sort(() => rand() - 0.5);
  const groups: [string, number[]][] = [
    [`gesucht (${names})`, shuffled.filter((r) => isWanted(file.printings[file.refs[r].p]))],
    ['Stichprobe', [...shuffled.filter((r) => file.refs[r].lang === 'en').slice(0, perLang), ...shuffled.filter((r) => file.refs[r].lang.startsWith('zh')).slice(0, perLang)]],
  ];
  const orientations = new Map<string, number>();
  for (const p of file.printings) {
    const o = String(p.attributes?.orientation ?? '-');
    orientations.set(o, (orientations.get(o) ?? 0) + 1);
  }
  console.log(`\n=== Sprache wie in der App (Ausrichtungen im Katalog: ${JSON.stringify(Object.fromEntries(orientations))})`);
  for (const [name, rows] of groups) {
    const stats = new Map<string, { n: number; full: number; slow: number; wrongZh: number; slowWrongZh: number; matches: number[] }>();
    let shown = 0;
    for (const r of rows) {
      const { p: truth, lang } = file.refs[r];
      const p = file.printings[truth];
      const original = await fullImage(p, lang);
      if (!original) continue;
      const meta = await sharp(original).metadata();
      const landscape = meta.width! > meta.height!;
      // Kamera: Querformat liegt hochkant im Rahmen, mal so, mal andersherum
      const turned = landscape ? await sharp(original).rotate(rand() < 0.5 ? 90 : 270).png().toBuffer() : original;
      const card = await (await distortTo(turned, 1100)).png().toBuffer();
      const texts: string[] = [];
      const cache = new Map<string, Promise<string>>();
      const read = (script: 'latin' | 'han') => {
        let t = cache.get(script);
        if (!t) {
          t = readCardForLanguage(card, p, script, workers);
          cache.set(script, t);
        }
        return t;
      };
      const match = (t: string) => latinMatch(index, truth, t);
      const opts = { match, noLatinBelow: NO_LATIN_BELOW, name: p.cardName };
      const full = await detectLanguage(read, p.texts ?? {}, languages, undefined, opts);
      const slow = await detectLanguage(async (sc) => (sc === 'latin' ? read('latin') : ''), p.texts ?? {}, languages, undefined, opts);
      const key = `${lang.startsWith('zh') ? 'zh' : 'en'}${landscape ? ' quer' : ''}`;
      const st = stats.get(key) ?? { n: 0, full: 0, slow: 0, wrongZh: 0, slowWrongZh: 0, matches: [] };
      st.n++;
      st.matches.push(match(await read('latin')));
      if (full.lang === lang) st.full++;
      if (slow.lang === lang) st.slow++;
      if (!lang.startsWith('zh') && full.lang?.startsWith('zh')) st.wrongZh++;
      if (!lang.startsWith('zh') && slow.lang?.startsWith('zh')) st.slowWrongZh++;
      stats.set(key, st);
      if (full.lang !== lang && shown++ < 12) {
        texts.push(`latin: ${(await read('latin')).replace(/\s+/g, ' ').slice(0, 140)}`);
        if (cache.has('han')) texts.push(`han: ${(await read('han')).replace(/\s+/g, ' ').slice(0, 100)}`);
        console.log(`  [${lang}] ${p.printingId} „${p.cardName}“ (${p.type}, ${String(p.attributes?.orientation ?? '-')}) → ${full.lang ?? 'unklar'} (${full.reason ?? '-'}), ohne Han → ${slow.lang ?? 'unklar'} (${slow.reason ?? '-'}), Passung EN ${match(await read('latin')).toFixed(2)}, ${JSON.stringify(full.scores)}\n    ${texts.join('\n    ')}`);
      }
    }
    console.log(`${name}:`);
    for (const [k, st] of stats) {
      const m = [...st.matches].sort((a, b) => a - b);
      const q = (f: number) => m[Math.floor(f * (m.length - 1))]?.toFixed(3) ?? '-';
      console.log(`  ${k}: ${st.n} Bilder, richtig ${st.full} (fälschlich chinesisch ${st.wrongZh}) · ohne chinesische Texterkennung richtig ${st.slow} (fälschlich chinesisch ${st.slowWrongZh}) · Passung EN min ${q(0)}, 10 % ${q(0.1)}, Median ${q(0.5)}, max ${q(1)}`);
    }
  }
  await workers.latin.terminate();
  await workers.han.terminate();
}

/** Liest das Kamerabild der Karte wie die App für die Spracherkennung. */
async function readCardForLanguage(card: Buffer, p: CatalogFile['printings'][number], script: 'latin' | 'han', workers: Record<'latin' | 'han', import('tesseract.js').Worker>): Promise<string> {
  const texts: string[] = [];
  for (const view of textViews(p)) {
    const turned = await sharp(card).rotate(view.rotate).png().toBuffer();
    texts.push((await workers[script].recognize(await regionOf(turned, view.region))).data.text);
  }
  return texts.join('\n');
}
