import type { Pixels } from './imageops';

/**
 * Spiegelung des Kameralichts (Blitz) auf der Karte.
 *
 * Hält man das Handy mit eingeschaltetem Licht gerade über die Karte, spiegelt sich die Lampe in
 * Lack, Foil oder Hülle: ein runder, fast weißer Fleck, meist mitten auf der Karte. Dort ist das Bild
 * übersteuert, vom Motiv bleibt nichts übrig. Für das Bildmodell sieht der Fleck wie ein Teil der Karte
 * aus und verfälscht den Bildvektor.
 *
 * Abhilfe ohne Kenntnis der Karte: Übersteuerte, farblose Flecken finden und aus ihrer Umgebung
 * glatt auffüllen (Push-Pull über eine Bildpyramide). Das Motiv im Fleck ist damit nicht zurück,
 * aber statt eines grellen Flecks sieht das Modell eine unauffällige Fläche in den Farben ringsum.
 * Weiße Stellen im Motiv bleiben unberührt, solange sie nicht zu einem großen übersteuerten Fleck gehören.
 */

export interface GlareConfig {
  /** Ab diesem dunkelsten Farbkanal (0–255) gilt ein Pixel als übersteuert (Kern des Flecks). */
  core: number;
  /** Höchstens so bunt (größter minus kleinster Kanal) ist der Kern; eine Spiegelung ist farblos. */
  chroma: number;
  /** Nur Flecken ab diesem Anteil der Kartenfläche zählen (kleine weiße Stellen im Motiv nicht). */
  minBlob: number;
  /** So viel (0–255) heller als weiter außen dürfen die dunklen Stellen eines Rings sein, ohne als Schleier zu gelten. */
  tolerance: number;
  /**
   * Ein Fleck zählt nur als Spiegelung, wenn sein Umfeld (Saum, bis 5 % der Bildbreite) mindestens so
   * stark aufgehellt ist (0–1, dunkle Stellen im Saum gegenüber der übrigen Karte). Eine Spiegelung
   * strahlt weich aus; eine weiße Fläche im Motiv (Textfeld) hört an ihrem Rand hart auf.
   */
  halo: number;
  /** Bis zu so vielen Fleckradien um die Mitte wird nach dem Schleier gesucht. */
  reach: number;
  /** Ab so viel Schleier (0–1) ist vom Motiv zu wenig übrig: dort auffüllen statt zurückrechnen. */
  fillFrom: number;
}

export const DEFAULT_GLARE: GlareConfig = { core: 238, chroma: 40, minBlob: 0.004, tolerance: 8, halo: 0.2, reach: 2, fillFrom: 0.6 };

export interface GlareMap {
  width: number;
  height: number;
  /** Lichtschleier je Pixel (0 = keiner, 1 = nur noch Lampe): Foto = Motiv · (1 − v) + Weiß · v. */
  veil: Float32Array;
  /** Je Pixel 0 = Motiv (zurückgerechnet), 1 = ganz aus der Umgebung auffüllen. */
  weight: Float32Array;
  /** Anteil der Fläche in übersteuerten Flecken (Kern), 0–1. */
  share: number;
  /** Aufhellung im Saum des größten übersteuerten Flecks (auch wenn er nicht als Spiegelung zählt), −1 ohne Fleck; zum Kalibrieren. */
  lift: number;
}

const minOf = (d: ArrayLike<number>, o: number) => Math.min(d[o], d[o + 1], d[o + 2]);
const maxOf = (d: ArrayLike<number>, o: number) => Math.max(d[o], d[o + 1], d[o + 2]);

/**
 * Findet übersteuerte Flecken (Kern) und schätzt den weichen Lichtschleier um den größten herum.
 */
export function glareMap(img: Pixels, config: GlareConfig = DEFAULT_GLARE): GlareMap {
  const { width: w, height: h, channels: c, data } = img;
  const n = w * h;
  const veil = new Float32Array(n), weight = new Float32Array(n);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * c;
    if (minOf(data, o) >= config.core && maxOf(data, o) - minOf(data, o) <= config.chroma) core[i] = 1;
  }
  // Zusammenhängende Kernflecken; zu kleine verwerfen (weiße Schrift, Lichtpunkte im Motiv)
  const seen = new Uint8Array(n);
  const keep = new Uint8Array(n);
  const stack: number[] = [];
  const minSize = Math.max(4, Math.round(config.minBlob * n));
  let kept = 0;
  let largest: number[] = [];
  let lift = -1, biggest = 0;
  // Vergleich: typische dunkle Stellen der Karte (Median der 10-%-Quantile je Zelle ohne Kern)
  const ref = typicalDark(data, w, h, c, core);
  const band = Math.max(3, Math.round(0.05 * w));
  for (let start = 0; start < n; start++) {
    if (!core[start] || seen[start]) continue;
    const members: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % w, y = (i - x) / w;
      const visit = (j: number) => {
        if (core[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    if (members.length < minSize) continue;
    const l = haloLift(members, data, w, h, c, core, band, ref);
    if (members.length > biggest) {
      biggest = members.length;
      lift = l;
    }
    if (l >= config.halo) {
      for (const i of members) keep[i] = 1;
      kept += members.length;
      if (members.length > largest.length) largest = members;
    }
  }
  if (!kept) return { width: w, height: h, veil, weight, share: 0, lift };

  // Lichtschleier um den größten Fleck: Die Lampe spiegelt sich rund, also je Ring um seine Mitte
  // messen, wie weit die dunklen Pixel angehoben sind (10-%-Quantil des dunkelsten Kanals), verglichen
  // mit Ringen weiter außen
  let sx = 0, sy = 0;
  for (const i of largest) {
    sx += i % w;
    sy += Math.floor(i / w);
  }
  const cx = sx / largest.length, cy = sy / largest.length;
  const radius = Math.sqrt(largest.length / Math.PI);
  const ring = Math.max(2, radius / 4);
  const rings = Math.ceil((2 * config.reach * radius) / ring) + 1;
  const hists = Array.from({ length: rings }, () => new Uint32Array(64));
  const counts = new Uint32Array(rings);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = Math.floor(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / ring);
    if (k >= rings) continue;
    hists[k][minOf(data, (y * w + x) * c) >> 2]++;
    counts[k]++;
  }
  const lo = Array.from(hists, (hist, k) => {
    let q = 0, acc = 0;
    while (q < 63 && acc + hist[q] < 0.1 * counts[k]) acc += hist[q++];
    return counts[k] >= 8 ? q * 4 + 2 : NaN;
  });
  const inner = Math.ceil((config.reach * radius) / ring);
  const far = lo.slice(inner).filter((v) => !Number.isNaN(v)).sort((p, q) => p - q);
  const ringRef = far.length ? far[far.length >> 1] : Math.min(...lo.filter((v) => !Number.isNaN(v)));
  const ringVeil = new Float32Array(inner + 1);
  for (let k = 0; k <= inner; k++) {
    const v = Number.isNaN(lo[k]) ? 0 : Math.max(0, (lo[k] - ringRef - config.tolerance) / Math.max(1, 255 - ringRef));
    // Nach außen nur schwächer werdend; einmal null bleibt null
    ringVeil[k] = k ? Math.min(v, ringVeil[k - 1]) : Math.min(1, v);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / ring - 0.5;
    let v = 0;
    if (t <= 0) v = ringVeil[0];
    else if (t < inner) {
      const k = Math.floor(t);
      v = ringVeil[k] * (1 - (t - k)) + ringVeil[k + 1] * (t - k);
    }
    // Nicht mehr Schleier, als das Pixel hergibt (sonst würde es schwärzer als schwarz)
    v = Math.min(v, minOf(data, i * c) / 255);
    if (keep[i]) v = 1;
    veil[i] = v;
    weight[i] = keep[i] ? 1 : Math.min(1, Math.max(0, (v - config.fillFrom + 0.15) / 0.3));
  }
  return { width: w, height: h, veil, weight, share: kept / n, lift };
}

/** 10-%-Quantil aus einem Histogramm (64 Stufen). */
function q10(hist: Uint32Array, count: number): number {
  let q = 0, acc = 0;
  while (q < 63 && acc + hist[q] < 0.1 * count) acc += hist[q++];
  return q * 4 + 2;
}

/** Wie hell sind die dunklen Stellen der Karte normalerweise? Median der Zellen (8 × 11) ohne übersteuerte Pixel. */
function typicalDark(data: ArrayLike<number>, w: number, h: number, c: number, core: Uint8Array): number {
  const cols = 8, rows = 11, values: number[] = [];
  const hist = new Uint32Array(64);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    hist.fill(0);
    let count = 0, clipped = false;
    for (let y = Math.floor((r * h) / rows); y < Math.floor(((r + 1) * h) / rows); y++)
      for (let x = Math.floor((q * w) / cols); x < Math.floor(((q + 1) * w) / cols); x++) {
        const i = y * w + x;
        if (core[i]) clipped = true;
        hist[minOf(data, i * c) >> 2]++;
        count++;
      }
    if (!clipped && count) values.push(q10(hist, count));
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/**
 * Aufhellung im Saum um einen Fleck (Abstand 2 bis band Pixel): 10-%-Quantil des dunkelsten Kanals
 * dort, verglichen mit ref, als Anteil des Wegs bis Weiß.
 */
function haloLift(members: number[], data: ArrayLike<number>, w: number, h: number, c: number, core: Uint8Array, band: number, ref: number): number {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (const i of members) {
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  x0 = Math.max(0, x0 - band); y0 = Math.max(0, y0 - band); x1 = Math.min(w - 1, x1 + band); y1 = Math.min(h - 1, y1 + band);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Schachbrett-Abstand zum Fleck (zwei Durchläufe)
  const dist = new Float32Array(bw * bh).fill(1e9);
  for (const i of members) {
    const x = i % w, y = (i - x) / w;
    dist[(y - y0) * bw + (x - x0)] = 0;
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    if (x) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
    if (y) dist[i] = Math.min(dist[i], dist[i - bw] + 1);
  }
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
    const i = y * bw + x;
    if (x < bw - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
    if (y < bh - 1) dist[i] = Math.min(dist[i], dist[i + bw] + 1);
  }
  const hist = new Uint32Array(64);
  let count = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const d = dist[y * bw + x];
    const i = (y + y0) * w + (x + x0);
    if (d < 2 || d > band || core[i]) continue;
    hist[minOf(data, i * c) >> 2]++;
    count++;
  }
  if (count < 8) return 0;
  return Math.max(0, (q10(hist, count) - ref) / Math.max(1, 255 - ref));
}

/**
 * Rechnet den Schleier heraus und füllt, wo zu wenig vom Motiv übrig ist, aus der Umgebung (Push-Pull): Das Bild wird mit Gewicht 1 − Spiegelung
 * schrittweise halbiert, dann von grob nach fein wieder aufgebaut; wo Gewicht fehlt, kommt die
 * gröbere Stufe zum Zug. Liefert ein neues RGB-Bild.
 */
export function fillGlare(img: Pixels, map: GlareMap): Pixels {
  const { width: w, height: h, channels: c } = img;
  // Schleier zurückrechnen: Motiv = (Foto − Weiß · v) / (1 − v)
  const data = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = Math.min(map.veil[i], 0.9);
    for (let k = 0; k < 3; k++) data[i * 3 + k] = Math.max(0, (img.data[i * c + k] - 255 * v) / (1 - v));
  }
  const n = w * h;
  type Level = { w: number; h: number; col: Float32Array; wt: Float32Array };
  const base: Level = { w, h, col: new Float32Array(n * 3), wt: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const v = 1 - map.weight[i];
    base.wt[i] = v;
    for (let k = 0; k < 3; k++) base.col[i * 3 + k] = data[i * 3 + k] * v;
  }
  const levels: Level[] = [base];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const f = levels[levels.length - 1];
    const lw = Math.max(1, Math.ceil(f.w / 2)), lh = Math.max(1, Math.ceil(f.h / 2));
    const next: Level = { w: lw, h: lh, col: new Float32Array(lw * lh * 3), wt: new Float32Array(lw * lh) };
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const s = y * f.w + x, d = (y >> 1) * lw + (x >> 1);
      next.wt[d] += f.wt[s];
      for (let k = 0; k < 3; k++) next.col[d * 3 + k] += f.col[s * 3 + k];
    }
    // Auf Gewicht höchstens 1 normieren: volle Zellen sind dann einfach ihre Durchschnittsfarbe
    for (let i = 0; i < lw * lh; i++) {
      if (next.wt[i] > 1) {
        for (let k = 0; k < 3; k++) next.col[i * 3 + k] /= next.wt[i];
        next.wt[i] = 1;
      }
    }
    levels.push(next);
  }
  // Von grob nach fein: fehlendes Gewicht aus der gröberen Stufe (bilinear) ergänzen
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l], g = levels[l + 1];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      const missing = 1 - Math.min(1, f.wt[i]);
      if (f.wt[i] > 1) {
        for (let k = 0; k < 3; k++) f.col[i * 3 + k] /= f.wt[i];
      }
      if (missing > 0) {
        const gx = Math.min(g.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), gy = Math.min(g.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
        const tx = gx - x0, ty = gy - y0;
        for (let k = 0; k < 3; k++) {
          const at = (xx: number, yy: number) => g.col[(yy * g.w + xx) * 3 + k];
          const up = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
          f.col[i * 3 + k] += missing * up;
        }
      }
      f.wt[i] = 1;
    }
  }
  const out = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n * 3; i++) out[i] = base.col[i];
  return { data: out, width: w, height: h, channels: 3 };
}

/**
 * Ab diesem Flächenanteil wird ausgebessert und in jedem der letzten GLARE_FRAMES Frames ein Hinweis
 * gezeigt. Vorläufig, gemessen mit `npm run eval -- --flash 300` (siehe dort).
 */
export const GLARE_FIX = 0.004;
export const GLARE_HINT = 0.015;
export const GLARE_FRAMES = 4;

/** Wie in der App vor der Erkennung: Spiegelung finden und, wenn deutlich, auffüllen. */
export function repairGlare(img: Pixels, config: GlareConfig = DEFAULT_GLARE): { pixels: Pixels; glare: number } {
  const map = glareMap(img, config);
  return { pixels: map.share >= GLARE_FIX ? fillGlare(img, map) : img, glare: map.share };
}
