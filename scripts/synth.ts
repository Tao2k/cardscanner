/**
 * Künstliche Handyfotos einer Karte: Tisch, Lage und Kippung, Spiegelung, Schatten, Hülle, Kamera.
 * Genutzt vom Modellvergleich (bench-recognition.ts, schwere Testfotos) und vom Katalog-Build
 * (leichte Lernfotos je Karte, siehe augmentedViews).
 */
import sharp from 'sharp';
import { squareToQuad, type Quad } from '../src/core/condition';
import { cropGuide, warpCardView } from '../src/core/cardview';
import type { Pixels } from '../src/core/imageops';
import { prepareForRecognition } from '../src/core/shading';

let seed = 7;
export const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
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

/** Zufall der Lernfotos je Referenzbild (unabhängig vom Zufall der Testfotos im Modellvergleich). */
export const augmentSeed = (row: number) => 1000003 + row * 7919;

/**
 * Leicht gestörte Fotos der Karte, so aufbereitet wie in der App (entzerrt, sonst Zielrahmen, dann
 * Schattenausgleich). Eigener Zufall je Karte, damit der Katalog bei jedem Build gleich ausfällt.
 */
export async function augmentedViews(card: Buffer, count: number, cardSeed: number): Promise<Pixels[]> {
  const saved = seed;
  seed = cardSeed >>> 0;
  try {
    const views: Pixels[] = [];
    for (let i = 0; i < count; i++) {
      const shot = await synthShot(card, false);
      views.push(prepareForRecognition(warpCardView(shot.frame, shot.guide) ?? cropGuide(shot.frame, shot.guide)).pixels);
    }
    return views;
  } finally {
    seed = saved;
  }
}
