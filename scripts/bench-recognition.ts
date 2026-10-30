/**
 * Vergleicht Bildmodelle und Verfahren für die Kartenerkennung auf künstlich erzeugten Handyfotos.
 *   npm run bench -- riftbound [--samples 400] [--models dinov2-small,dinov3-small] [--augment 4]
 * Voraussetzung: `npm run catalog -- <spiel>` ist gelaufen (Bild-Cache und Vergleichsbilder in ref/).
 *
 * Die Testfotos sind schwerer als in eval-recognition.ts: Karte auf einem Tisch, leicht gekippt
 * (Perspektive), nicht genau im Zielrahmen, mit Spiegelung, Schatten, Hüllenschleier, Farbstich,
 * Unschärfe, Rauschen und JPEG. Gemessen wird je Modell und Verfahren:
 * - Top-1/Top-3 über alle Testfotos und je Störung
 * - Anteil, der automatisch gespeichert werden darf, wenn darunter ≥ 95 % richtig sein müssen
 * - Rechenzeit je Bild mit einem Rechenkern (näher am Handy als mehrere Kerne) und Modellgröße
 * Alles ist synthetisch; echte Fotos können besser oder schlechter abschneiden.
 */
import { createHash } from 'node:crypto';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { imageIn, type CatalogFile } from '../src/core/catalog';
import { findCard, squareToQuad, toGray, type Quad } from '../src/core/condition';
import { letterboxToSquare, type Pixels } from '../src/core/imageops';
import { collapseToPrintings, l2normalize, topK, type Match } from '../src/core/matcher';

const args = process.argv.slice(2);
const game = args.find((a) => !a.startsWith('--')) ?? 'riftbound';
const option = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const samples = Number(option('--samples', '400'));
const augment = Number(option('--augment', '0'));
/** Karten, die gezielt geprüft werden (Teil des Namens, mehrere mit |), je Druck 8 zusätzliche Testfotos */
const focus = option('--focus', '').toLowerCase().split('|').filter(Boolean);
/** Regel der App heute (src/core/stabilizer.ts): Mindestähnlichkeit und Abstand für automatisches Speichern */
const APP_MIN_SCORE = 0.55;
const APP_MARGIN = 0.06;
// Eigener Ordner, damit die Vergleichsmodelle nicht mit der App ausgeliefert werden
const MODEL_DIR = '.cache/bench-models';
const CACHE = '.cache/bench';

// --- Kandidaten ---------------------------------------------------------------------------------

type Prep = 'crop' | 'full' | 'aspect';
interface Candidate {
  key: string;
  id: string;
  dtype: string;
  kind: 'dino' | 'clip' | 'siglip';
  /** crop: Quadrat + Mitte ausschneiden (wie bisher), full: ganzes Quadrat, aspect: Kartenformat ohne Rand */
  prep: Prep;
  /** Register-Token nach dem Klassen-Token (DINOv3: 4) */
  registers?: number;
}

const CANDIDATES: Candidate[] = [
  { key: 'dinov2-small', id: 'Xenova/dinov2-small', dtype: 'q8', kind: 'dino', prep: 'crop' },
  { key: 'dinov2-small-full', id: 'Xenova/dinov2-small', dtype: 'q8', kind: 'dino', prep: 'full' },
  { key: 'dinov2-small-aspect', id: 'Xenova/dinov2-small', dtype: 'q8', kind: 'dino', prep: 'aspect' },
  { key: 'dinov2-small-fp32', id: 'Xenova/dinov2-small', dtype: 'fp32', kind: 'dino', prep: 'crop' },
  { key: 'dinov2-base', id: 'Xenova/dinov2-base', dtype: 'q8', kind: 'dino', prep: 'crop' },
  { key: 'dinov2-reg-small', id: 'onnx-community/dinov2-with-registers-small|onnx-community/dinov2-with-registers-small-ONNX', dtype: 'q8', kind: 'dino', prep: 'crop', registers: 4 },
  { key: 'dinov3-small', id: 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX|onnx-community/dinov3-vits16-pretrain-lvd1689m', dtype: 'q8', kind: 'dino', prep: 'full', registers: 4 },
  { key: 'dinov3-small-aspect', id: 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX|onnx-community/dinov3-vits16-pretrain-lvd1689m', dtype: 'q8', kind: 'dino', prep: 'aspect', registers: 4 },
  { key: 'dinov3-base', id: 'onnx-community/dinov3-vitb16-pretrain-lvd1689m-ONNX|onnx-community/dinov3-vitb16-pretrain-lvd1689m', dtype: 'q8', kind: 'dino', prep: 'full', registers: 4 },
  { key: 'clip-b32', id: 'Xenova/clip-vit-base-patch32', dtype: 'q8', kind: 'clip', prep: 'full' },
  { key: 'siglip-b16', id: 'Xenova/siglip-base-patch16-224', dtype: 'q8', kind: 'siglip', prep: 'full' },
  { key: 'siglip-b16-fp16', id: 'Xenova/siglip-base-patch16-224', dtype: 'fp16', kind: 'siglip', prep: 'full' },
  { key: 'siglip2-b16', id: 'onnx-community/siglip2-base-patch16-224-ONNX|onnx-community/siglip2-base-patch16-224', dtype: 'q8', kind: 'siglip', prep: 'full' },
];

interface Vectors {
  cls: Float32Array;
  /** Klassen-Token und Mittel der Bildfelder, je auf Länge 1 und aneinandergehängt (nur DINO) */
  mix?: Float32Array;
}

interface BenchEmbedder {
  embed(img: Pixels): Promise<Vectors>;
}

async function createBenchEmbedder(c: Candidate, threads?: number): Promise<BenchEmbedder> {
  const t = await import('@huggingface/transformers');
  t.env.cacheDir = MODEL_DIR;
  // Mehrere mögliche Namen auf Hugging Face, durch | getrennt; der erste vorhandene zählt
  let id = '';
  let processor: Awaited<ReturnType<typeof t.AutoProcessor.from_pretrained>> | null = null;
  let lastError: unknown;
  for (const candidate of c.id.split('|')) {
    try {
      processor = await t.AutoProcessor.from_pretrained(candidate);
      id = candidate;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!processor) throw lastError;
  const ip = (processor as unknown as { image_processor: Record<string, unknown> }).image_processor;
  const patch = id.includes('dinov2') ? 14 : 16;
  if (c.prep !== 'crop') {
    ip.do_center_crop = false;
    ip.size = c.prep === 'aspect' ? { height: patch * 22, width: patch * 16 } : { height: 224, width: 224 };
  }
  const opts: Record<string, unknown> = { dtype: c.dtype };
  if (threads) opts.session_options = { intraOpNumThreads: threads, interOpNumThreads: 1 };
  const Model = c.kind === 'clip' ? t.CLIPVisionModelWithProjection : c.kind === 'siglip' ? t.SiglipVisionModel : t.AutoModel;
  const model = await (Model as typeof t.AutoModel).from_pretrained(id, opts as never);
  return {
    async embed(img: Pixels) {
      const input = c.prep === 'aspect' ? toRgb(img) : letterboxToSquare(img);
      const raw = new t.RawImage(input.data, input.width, input.height, 3);
      const out = await model(await processor(raw));
      if (c.kind === 'clip') return { cls: l2normalize(Float32Array.from(out.image_embeds.data)) };
      if (c.kind === 'siglip') return { cls: l2normalize(Float32Array.from(out.pooler_output.data)) };
      const hidden = out.last_hidden_state; // [1, tokens, dim]
      const [, tokens, dim] = hidden.dims as number[];
      const data = hidden.data as Float32Array;
      const cls = l2normalize(Float32Array.from(data.subarray(0, dim)));
      const mean = new Float32Array(dim);
      const first = 1 + (c.registers ?? 0);
      for (let tk = first; tk < tokens; tk++) for (let i = 0; i < dim; i++) mean[i] += data[tk * dim + i];
      l2normalize(mean);
      const mix = new Float32Array(dim * 2);
      mix.set(cls, 0);
      mix.set(mean, dim);
      for (let i = 0; i < mix.length; i++) mix[i] /= Math.SQRT2;
      return { cls, mix };
    },
  };
}

function toRgb(img: Pixels): Pixels {
  if (img.channels === 3) return img;
  const out = new Uint8ClampedArray(img.width * img.height * 3);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) [out[i], out[i + 1], out[i + 2]] = [img.data[j], img.data[j + 1], img.data[j + 2]];
  return { data: out, width: img.width, height: img.height, channels: 3 };
}

function modelSize(c: Candidate): string {
  const dir = c.id.split('|').map((id) => path.join(MODEL_DIR, ...id.split('/'), 'onnx')).find((d) => existsSync(d));
  if (!dir) return '?';
  const suffix = c.dtype === 'fp32' ? '' : `_${c.dtype === 'q8' ? 'quantized' : c.dtype}`;
  const names = readdirSync(dir).filter((f) => f.endsWith(`${suffix}.onnx`) && (c.kind === 'dino' || f.includes('vision')) && (suffix || !f.includes('_')));
  const bytes = names.reduce((s, f) => s + statSync(path.join(dir, f)).size + (existsSync(path.join(dir, `${f}_data`)) ? statSync(path.join(dir, `${f}_data`)).size : 0), 0);
  return bytes ? `${(bytes / 2 ** 20).toFixed(0)} MB` : '?';
}

// --- Zufall und Bildsynthese --------------------------------------------------------------------

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (a: number, b: number) => a + rand() * (b - a);

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
}

/** Bilinear abtasten, liefert RGBA (Alpha 0 außerhalb). */
function sampleRgba(img: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }, x: number, y: number, out: number[]) {
  if (x < 0 || y < 0 || x > img.width - 1 || y > img.height - 1) return void out.fill(0);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, img.width - 1), y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0, fy = y - y0;
  for (let k = 0; k < 4; k++) {
    const p = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + k];
    out[k] = (p(y0, x0) * (1 - fx) + p(y0, x1) * fx) * (1 - fy) + (p(y1, x0) * (1 - fx) + p(y1, x1) * fx) * fy;
  }
}

export interface Shot {
  /** Kamerabild um den Zielrahmen (RGB) */
  frame: Pixels;
  guide: { x: number; y: number; width: number; height: number };
  tags: string[];
}

const GUIDE_H = 400;
const GUIDE_W = Math.round((GUIDE_H * 63) / 88);
const MARGIN = Math.round(GUIDE_H * 0.1);

/**
 * Legt die Karte als Handyfoto in einen Kamerausschnitt: Tisch, Lage und Kippung, Licht, Kamera.
 * hard=false erzeugt nur leichte Störungen (für zusätzliche Referenzbilder).
 */
export async function synthShot(card: Buffer, hard = true): Promise<Shot> {
  const tags: string[] = [];
  const { data: cd, info } = await sharp(card).ensureAlpha().resize({ height: 560 }).raw().toBuffer({ resolveWithObject: true });
  const src = { data: new Uint8ClampedArray(cd.buffer, cd.byteOffset, cd.length), width: info.width, height: info.height };
  // Spiegelung (Lampe auf Hülle/Foil) und Hüllenschleier direkt auf der Karte
  if (rand() < (hard ? 0.45 : 0.25)) {
    tags.push('Spiegelung');
    const u0 = between(0.1, 0.9) * src.width, v0 = between(0.1, 0.9) * src.height;
    const rx = between(0.08, 0.35) * src.width, ry = between(0.05, 0.25) * src.height, a = between(0.4, hard ? 0.95 : 0.6);
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const d = ((x - u0) / rx) ** 2 + ((y - v0) / ry) ** 2;
      const w = a * Math.exp(-d);
      const k = (y * src.width + x) * 4;
      for (let ch = 0; ch < 3; ch++) src.data[k + ch] += (255 - src.data[k + ch]) * w;
    }
  }
  if (rand() < 0.3) {
    tags.push('Hülle');
    const haze = between(0.04, 0.14);
    for (let k = 0; k < src.data.length; k += 4) for (let ch = 0; ch < 3; ch++) src.data[k + ch] = src.data[k + ch] * (1 - haze) + 235 * haze;
  }
  // Lage im Zielrahmen: Größe, Versatz, Drehung, Kippung
  const W = GUIDE_W + 2 * MARGIN, H = GUIDE_H + 2 * MARGIN;
  const scale = hard ? between(0.86, 1.04) : between(0.95, 1.02);
  const cx = W / 2 + between(-0.06, 0.06) * GUIDE_W * (hard ? 1 : 0.4), cy = H / 2 + between(-0.05, 0.05) * GUIDE_H * (hard ? 1 : 0.4);
  const angle = ((hard ? between(-6, 6) : between(-2, 2)) * Math.PI) / 180;
  const hw = (GUIDE_W * scale) / 2, hh = (GUIDE_H * scale) / 2;
  const tilt = hard ? between(0, 0.08) : between(0, 0.02);
  if (tilt > 0.04) tags.push('Gekippt');
  const tiltSide = Math.floor(rand() * 4);
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y], i) => {
    // Kippung: eine Seite der Karte erscheint kleiner (weiter weg)
    const far = (tiltSide === 0 && i < 2) || (tiltSide === 1 && (i === 1 || i === 2)) || (tiltSide === 2 && i >= 2) || (tiltSide === 3 && (i === 0 || i === 3));
    const f = far ? 1 - tilt : 1;
    const px = x * f, py = y * f;
    return { x: cx + px * Math.cos(angle) - py * Math.sin(angle), y: cy + px * Math.sin(angle) + py * Math.cos(angle) };
  }) as Quad;
  const inv = invert3(squareToQuad(corners));
  // Tisch: Grundfarbe, Verlauf, Maserung
  const bg = [between(15, 235), between(15, 235), between(15, 235)];
  const grain = rand() < 0.4 ? between(4, 18) : 0;
  const out = new Uint8ClampedArray(W * H * 3);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const w = inv[6] * x + inv[7] * y + inv[8];
    const u = (inv[0] * x + inv[1] * y + inv[2]) / w, v = (inv[3] * x + inv[4] * y + inv[5]) / w;
    sampleRgba(src, u * src.width - 0.5, v * src.height - 0.5, px);
    const a = px[3] / 255;
    const tex = grain * Math.sin(y * 0.15 + Math.sin(x * 0.02) * 3) + (rand() - 0.5) * 8;
    const k = (y * W + x) * 3;
    for (let ch = 0; ch < 3; ch++) out[k + ch] = px[ch] * a + (bg[ch] + tex) * (1 - a);
  }
  // Schatten (Hand/Handy) als weicher Verlauf über einen Teil des Bilds
  if (rand() < (hard ? 0.4 : 0.2)) {
    tags.push('Schatten');
    const dir = between(0, 2 * Math.PI), dx = Math.cos(dir), dy = Math.sin(dir);
    const off = between(-0.2, 0.3), depth = between(0.3, hard ? 0.65 : 0.4), soft = between(0.05, 0.2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = ((x / W - 0.5) * dx + (y / H - 0.5) * dy - off) / soft;
      const f = 1 - depth / (1 + Math.exp(-s));
      const k = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch++) out[k + ch] *= f;
    }
  }
  // Kamera: Belichtung, Weißabgleich, Unschärfe, Rauschen, Kompression
  const bright = hard ? between(0.55, 1.25) : between(0.8, 1.15);
  if (bright < 0.75) tags.push('Dunkel');
  const cast = [between(0.88, 1.12), between(0.92, 1.08), between(0.85, 1.15)];
  const sigma = hard ? between(0.4, 2.0) : between(0.3, 1.0);
  if (sigma > 1.4) tags.push('Unscharf');
  const noise = hard ? between(2, 9) : between(1, 4);
  for (let k = 0; k < out.length; k++) out[k] = out[k] * bright * cast[k % 3] + (rand() - 0.5) * 2 * noise;
  const jpeg = await sharp(Buffer.from(out.buffer), { raw: { width: W, height: H, channels: 3 } })
    .blur(sigma)
    .jpeg({ quality: Math.round(hard ? between(45, 85) : between(70, 90)) })
    .toBuffer();
  const { data, info: fi } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  if (!tags.length) tags.push('Ohne');
  return {
    frame: { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: fi.width, height: fi.height, channels: 3 },
    guide: { x: MARGIN, y: MARGIN, width: GUIDE_W, height: GUIDE_H },
    tags,
  };
}

/** Ausschnitt wie in der App: genau der Zielrahmen, auf 320 px Höhe. */
async function guideCrop(shot: Shot): Promise<Pixels> {
  const { frame, guide } = shot;
  const { data, info } = await sharp(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.length), { raw: { width: frame.width, height: frame.height, channels: 3 } })
    .extract({ left: guide.x, top: guide.y, width: guide.width, height: guide.height })
    .resize({ height: 320 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 };
}

/** Karte entzerren: Kanten wie bei der Zustandsschätzung suchen, dann auf 229 × 320 px ziehen. */
export function warpShot(shot: Shot): Pixels | null {
  const quad = findCard(toGray(shot.frame), shot.guide);
  if (!quad) return null;
  const m = squareToQuad(quad);
  const W = 229, H = 320;
  const out = new Uint8ClampedArray(W * H * 3);
  const f = shot.frame;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    const w = m[6] * u + m[7] * v + 1;
    const sx = Math.max(0, Math.min(f.width - 1, (m[0] * u + m[1] * v + m[2]) / w - 0.5));
    const sy = Math.max(0, Math.min(f.height - 1, (m[3] * u + m[4] * v + m[5]) / w - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, f.width - 1), y1 = Math.min(y0 + 1, f.height - 1);
    const fx = sx - x0, fy = sy - y0;
    for (let ch = 0; ch < 3; ch++) {
      const p = (yy: number, xx: number) => f.data[(yy * f.width + xx) * 3 + ch];
      out[(y * W + x) * 3 + ch] = (p(y0, x0) * (1 - fx) + p(y0, x1) * fx) * (1 - fy) + (p(y1, x0) * (1 - fx) + p(y1, x1) * fx) * fy;
    }
  }
  return { data: out, width: W, height: H, channels: 3 };
}

// --- Nachsortieren der besten Treffer per Pixelvergleich ----------------------------------------

const CW = 32, CH = 44;

/** Graustufen-Raster der Karte, mittelwertfrei und auf Länge 1, für die Korrelation. */
async function patchOf(img: Buffer | Pixels): Promise<Float32Array> {
  const s = Buffer.isBuffer(img)
    ? sharp(img).flatten({ background: '#808080' })
    : sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: img.channels } });
  const { data } = await s.resize(CW, CH, { fit: 'fill' }).grayscale().normalise().raw().toBuffer({ resolveWithObject: true });
  // Rand (3 Pixel) weglassen, dort liegen bei ungenauem Ausschnitt Tisch oder Kartenkante
  const v: number[] = [];
  for (let y = 3; y < CH - 3; y++) for (let x = 3; x < CW - 3; x++) v.push(data[y * CW + x]);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return l2normalize(Float32Array.from(v, (x) => x - mean));
}

const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

// --- Auswertung ---------------------------------------------------------------------------------

interface Result {
  truth: number;
  ranked: Match[];
  tags: string[];
}

function wilson(k: number, n: number) {
  if (!n) return 0;
  const z = 1.96, p = k / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

/** Größter Anteil automatisch gespeicherter Scans (sortiert nach Abstand Platz 1 zu 2), bei dem ≥ 95 % (untere Schranke) richtig sind. */
function autoShare(results: Result[]): { share: number; margin: number } {
  const list = results.map((r) => ({ margin: r.ranked[0].score - (r.ranked[1]?.score ?? 0), right: r.ranked[0].index === r.truth })).sort((a, b) => b.margin - a.margin);
  let best = { share: 0, margin: Infinity };
  let k = 0;
  list.forEach((x, i) => {
    if (x.right) k++;
    if (wilson(k, i + 1) >= 0.95 && (i + 1 === list.length || list[i + 1].margin < x.margin)) best = { share: (i + 1) / list.length, margin: x.margin };
  });
  return best;
}

function summarize(results: Result[]) {
  const n = results.length;
  const top1 = results.filter((r) => r.ranked[0]?.index === r.truth).length;
  const top3 = results.filter((r) => r.ranked.slice(0, 3).some((m) => m.index === r.truth)).length;
  const byTag = new Map<string, { n: number; hit: number }>();
  for (const r of results) for (const tag of r.tags) {
    const s = byTag.get(tag) ?? { n: 0, hit: 0 };
    s.n++;
    if (r.ranked[0]?.index === r.truth) s.hit++;
    byTag.set(tag, s);
  }
  // Wie die App heute: unter der Mindestähnlichkeit passiert nichts, sonst ab Abstand 0,06 speichern
  const silent = results.filter((r) => r.ranked[0].score < APP_MIN_SCORE).length;
  const appAuto = results.filter((r) => r.ranked[0].score >= APP_MIN_SCORE && r.ranked[0].score - (r.ranked[1]?.score ?? 0) >= APP_MARGIN);
  const appRight = appAuto.filter((r) => r.ranked[0].index === r.truth).length;
  return { top1: top1 / n, top3: top3 / n, auto: autoShare(results), byTag, silent: silent / n, appAuto: appAuto.length / n, appPrecision: appRight / (appAuto.length || 1) };
}

const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

/** Kalibrierung für die App: Abstand → Anteil richtig (mit unterer Schranke) und Lage der Bestwerte. */
function calibration(results: Result[]) {
  const q = (xs: number[], f: number) => xs.sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))]?.toFixed(3) ?? '-';
  const right = results.filter((r) => r.ranked[0].index === r.truth).map((r) => r.ranked[0].score);
  const wrong = results.filter((r) => r.ranked[0].index !== r.truth).map((r) => r.ranked[0].score);
  console.log(`    Bestwert richtig: 5 % ${q(right, 0.05)}, 10 % ${q(right, 0.1)}, Median ${q(right, 0.5)} · falsch: Median ${q(wrong, 0.5)}, 90 % ${q(wrong, 0.9)}`);
  const EDGES = [0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 1];
  const list = results.map((r) => ({ margin: r.ranked[0].score - (r.ranked[1]?.score ?? 0), right: r.ranked[0].index === r.truth }));
  const rows: string[] = [];
  for (let b = 0; b + 1 < EDGES.length; b++) {
    const bin = list.filter((x) => x.margin >= EDGES[b] && x.margin < EDGES[b + 1]);
    const above = list.filter((x) => x.margin >= EDGES[b]);
    const k = bin.filter((x) => x.right).length, ka = above.filter((x) => x.right).length;
    rows.push(`${EDGES[b].toFixed(3)}: ${k}/${bin.length} (≥ ${(100 * wilson(k, bin.length)).toFixed(0)} %), ab hier ≥ ${(100 * wilson(ka, above.length)).toFixed(1)} %`);
  }
  console.log(`    Abstand → richtig: ${rows.join(' · ')}`);
}

async function main() {
  const dir = path.join('public/data', game);
  const file: CatalogFile = JSON.parse(await readFile(path.join(dir, 'catalog.json'), 'utf8'));
  await mkdir(CACHE, { recursive: true });
  const imagePath = (row: number) => {
    const { p, lang } = file.refs[row];
    return path.join('.cache/images', createHash('sha1').update(imageIn(file.printings[p], lang).imageUrl).digest('hex'));
  };
  const wanted = option('--models', CANDIDATES.map((c) => c.key).join(',')).split(',');
  const candidates = CANDIDATES.filter((c) => wanted.includes(c.key));

  // Testfotos einmal erzeugen, für alle Modelle dieselben
  const rows = [...file.refs.keys()].sort(() => rand() - 0.5).slice(0, samples);
  const focusRows = file.refs.flatMap((r, row) => (focus.some((f) => file.printings[r.p].cardName.toLowerCase().includes(f)) ? [row] : []));
  for (const row of focusRows) {
    const p = file.printings[file.refs[row].p];
    console.log(`Fokus: ${p.printingId} [${file.refs[row].lang}] ${p.cardName} (${p.variant})`);
  }
  console.log(`Erzeuge ${rows.length} Testfotos …`);
  const shots: { row: number; truth: number; shot: Shot; crop: Pixels; warp: Pixels | null }[] = [];
  for (const row of rows) {
    const shot = await synthShot(await readFile(imagePath(row)));
    shots.push({ row, truth: file.refs[row].p, shot, crop: await guideCrop(shot), warp: warpShot(shot) });
  }
  // Fokus-Karten kommen dazu, zählen aber nicht in die Gesamtwerte
  const mainCount = shots.length;
  for (const row of focusRows) for (let i = 0; i < 8; i++) {
    const shot = await synthShot(await readFile(imagePath(row)));
    shot.tags = ['Fokus'];
    shots.push({ row, truth: file.refs[row].p, shot, crop: await guideCrop(shot), warp: warpShot(shot) });
  }
  const found = shots.slice(0, mainCount).filter((s) => s.warp).length;
  console.log(`Karte gefunden und entzerrt: ${found}/${mainCount} (${pct(found / mainCount)})`);

  // Vergleichsraster für das Nachsortieren
  const refPatches = await Promise.all(file.refs.map((r) => (r.g && existsSync(path.join(dir, r.g)) ? readFile(path.join(dir, r.g)).then(patchOf) : null)));
  const shotPatches = await Promise.all(shots.map((s) => patchOf(s.warp ?? s.crop)));

  const table: string[] = [];
  const header = `| Modell / Verfahren | Top-1 | Top-3 | automatisch (≥95 %) | App-Regel: stumm / gespeichert (richtig) | Fokus Top-1 | ms/Bild 1 Kern | Größe |`;
  for (const c of candidates) {
    console.log(`\n=== ${c.key} (${c.id} ${c.dtype}, ${c.prep})`);
    let embedder: BenchEmbedder;
    try {
      embedder = await createBenchEmbedder(c);
    } catch (e) {
      console.log(`  übersprungen: ${(e as Error).message}`);
      table.push(`| ${c.key} | – | – | – | – | – | – | nicht ladbar |`);
      continue;
    }
    // Katalog einbetten (zwischengespeichert)
    const cacheFile = path.join(CACHE, `${c.key}${augment ? `-aug${augment}` : ''}.json`);
    let refCls: Float32Array[], refMix: (Float32Array | undefined)[], refAug: Float32Array[] | null = null;
    try {
      const t0 = Date.now();
      if (existsSync(cacheFile)) {
        const j = JSON.parse(await readFile(cacheFile, 'utf8'));
        refCls = j.cls.map((v: number[]) => Float32Array.from(v));
        refMix = j.mix.map((v: number[] | null) => (v ? Float32Array.from(v) : undefined));
        refAug = j.aug ? j.aug.map((v: number[]) => Float32Array.from(v)) : null;
      } else {
        refCls = [];
        refMix = [];
        const aug: Float32Array[] = [];
        for (let row = 0; row < file.refs.length; row++) {
          const buf = await readFile(imagePath(row));
          const { data, info } = await sharp(buf).flatten({ background: '#808080' }).resize({ height: 320 }).raw().toBuffer({ resolveWithObject: true });
          const v = await embedder.embed({ data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, channels: 3 });
          refCls.push(v.cls);
          refMix.push(v.mix);
          if (augment) {
            // Prototyp: Mittel aus Original und leicht gestörten Fotos derselben Karte (anderer Zufall als die Testfotos)
            const sum = Float32Array.from(v.cls);
            const saved = seed;
            seed = 1000003 + row * 7919;
            for (let a = 0; a < augment; a++) {
              const s = await synthShot(buf, false);
              const e = await embedder.embed(warpShot(s) ?? (await guideCrop(s)));
              for (let i = 0; i < sum.length; i++) sum[i] += e.cls[i];
            }
            seed = saved;
            aug.push(l2normalize(sum));
          }
          if ((row + 1) % 500 === 0) console.log(`  Katalog ${row + 1}/${file.refs.length}`);
        }
        if (augment) refAug = aug;
        await writeFile(cacheFile, JSON.stringify({ cls: refCls.map((v) => [...v]), mix: refMix.map((v) => (v ? [...v] : null)), aug: refAug?.map((v) => [...v]) ?? null }));
      }
      console.log(`  Katalog eingebettet in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    } catch (e) {
      console.log(`  Fehler beim Einbetten: ${(e as Error).message}`);
      table.push(`| ${c.key} | – | – | – | – | – | – | Fehler |`);
      continue;
    }
    const flat = (vs: Float32Array[]) => {
      const d = vs[0].length;
      const out = new Float32Array(vs.length * d);
      vs.forEach((v, i) => out.set(v, i * d));
      return { out, d };
    };
    const indexes: Record<string, { out: Float32Array; d: number }> = { cls: flat(refCls) };
    if (refMix[0]) indexes.mix = flat(refMix as Float32Array[]);
    if (refAug) indexes.aug = flat(refAug);

    // Testfotos einbetten: Zielrahmen wie heute und entzerrt
    const q: Record<'crop' | 'warp', Vectors[]> = { crop: [], warp: [] };
    for (const s of shots) {
      const crop = await embedder.embed(s.crop);
      q.crop.push(crop);
      q.warp.push(s.warp ? await embedder.embed(s.warp) : crop);
    }
    // Rechenzeit mit einem Kern
    let ms = NaN;
    try {
      const single = await createBenchEmbedder(c, 1);
      await single.embed(shots[0].crop);
      const times: number[] = [];
      for (const s of shots.slice(0, 15)) {
        const t0 = performance.now();
        await single.embed(s.crop);
        times.push(performance.now() - t0);
      }
      ms = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
    } catch (e) {
      console.log(`  Zeitmessung fehlgeschlagen: ${(e as Error).message}`);
    }
    const size = modelSize(c);

    const run = (label: string, index: { out: Float32Array; d: number }, vecs: (v: Vectors) => Float32Array | undefined, source: 'crop' | 'warp', rerank = 0) => {
      const results: Result[] = shots.map((s, i) => {
        const v = vecs(q[source][i])!;
        let ranked = collapseToPrintings(topK(v, index.out, index.d, 24), (row) => file.refs[row].p, 8);
        if (rerank) {
          const sp = shotPatches[i];
          ranked = ranked
            .map((m) => {
              const rowsOf = file.refs.flatMap((r, row) => (r.p === m.index ? [row] : []));
              const ncc = Math.max(...rowsOf.map((row) => (refPatches[row] ? dot(sp, refPatches[row]!) : -1)));
              return { index: m.index, score: m.score + rerank * ncc };
            })
            .sort((a, b) => b.score - a.score);
        }
        return { truth: s.truth, ranked, tags: s.shot.tags };
      });
      const sum = summarize(results.slice(0, mainCount));
      if (label === 'Zielrahmen' || label.endsWith('Pixelvergleich 0.2')) calibration(results.slice(0, mainCount));
      const focused = results.slice(mainCount);
      const focusTop1 = focused.length ? pct(focused.filter((r) => r.ranked[0].index === r.truth).length / focused.length) : '–';
      if (focused.length && label === 'Zielrahmen') {
        const name = (i: number) => `${file.printings[i].printingId} ${file.printings[i].cardName} (${file.printings[i].variant})`;
        for (const r of focused) console.log(`    Fokus ${name(r.truth)} → ${name(r.ranked[0].index)} ${r.ranked[0].score.toFixed(3)} / ${r.ranked[1].score.toFixed(3)}`);
      }
      console.log(`  ${label}: Top-1 ${pct(sum.top1)}, Top-3 ${pct(sum.top3)}, automatisch ${pct(sum.auto.share)} (ab Abstand ${sum.auto.margin.toFixed(3)})`);
      console.log(`    je Störung: ${[...sum.byTag].map(([t, s]) => `${t} ${pct(s.hit / s.n)} (${s.n})`).join(', ')}`);
      console.log(`    App-Regel heute: stumm ${pct(sum.silent)}, gespeichert ${pct(sum.appAuto)} (davon richtig ${pct(sum.appPrecision)}), Fokus Top-1 ${focusTop1}`);
      table.push(`| ${c.key} ${label} | ${pct(sum.top1)} | ${pct(sum.top3)} | ${pct(sum.auto.share)} | ${pct(sum.silent)} / ${pct(sum.appAuto)} (${pct(sum.appPrecision)}) | ${focusTop1} | ${ms.toFixed(0)} | ${size} |`);
    };
    run('Zielrahmen', indexes.cls, (v) => v.cls, 'crop');
    run('entzerrt', indexes.cls, (v) => v.cls, 'warp');
    if (indexes.mix) run('entzerrt + Feldmittel', indexes.mix, (v) => v.mix, 'warp');
    for (const w of [0.05, 0.1, 0.2]) run(`entzerrt + Pixelvergleich ${w}`, indexes.cls, (v) => v.cls, 'warp', w);
    if (indexes.aug) {
      run(`entzerrt + ${augment} Lernfotos je Karte`, indexes.aug, (v) => v.cls, 'warp');
      run(`entzerrt + ${augment} Lernfotos + Pixelvergleich 0.1`, indexes.aug, (v) => v.cls, 'warp', 0.1);
    }
  }
  console.log(`\n=== Übersicht (${mainCount} synthetische Fotos, Karte entzerrt in ${pct(found / mainCount)})\n${header}\n|---|---|---|---|---|---|---|---|\n${table.join('\n')}`);
}

if (process.argv[1]?.includes('bench-recognition')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
