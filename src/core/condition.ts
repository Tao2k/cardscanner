import type { Rect } from './geometry';
import type { Pixels } from './imageops';
import { CONDITIONS, type Condition } from './types';

/**
 * Grobe Zustandsschätzung aus einem Kamerabild.
 *
 * Gemessen wird nur, was ein Handyfoto zuverlässig zeigt: weiße Abnutzung an Kanten und Ecken.
 * Dazu werden die Kartenkanten im Bild gesucht, die Karte entzerrt und Pixel für Pixel mit dem
 * offiziellen Kartenbild verglichen. Was dort dunkel ist, im Foto aber fast weiß, gilt als
 * abgenutzt. Kratzer, Knicke und Druckstellen sieht das Verfahren nicht; PO wird nie geschätzt.
 */

export interface Gray {
  data: Float32Array;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Ecken der Karte im Bild: oben links, oben rechts, unten rechts, unten links. */
export type Quad = [Point, Point, Point, Point];

export interface ConditionEstimate {
  /** null = keine Schätzung möglich (Grund in reason). */
  condition: Exclude<Condition, 'PO'> | null;
  reason?: string;
  /** Anteil weißer Pixel am Kantenstreifen ohne Ecken und an der schlimmsten Ecke. */
  edge: number;
  corner: number;
  /** Übereinstimmung des Fotos mit dem Original (Korrelation, 1 = perfekt). */
  fit: number;
  quad?: Quad;
}

export interface ConditionThresholds {
  /** Obergrenzen [Kanten, Ecken] je Stufe; darüber ist es die nächstschlechtere. */
  NM: [number, number];
  EX: [number, number];
  GD: [number, number];
  LP: [number, number];
}

export const DEFAULT_THRESHOLDS: ConditionThresholds = {
  NM: [0.004, 0.04],
  EX: [0.025, 0.15],
  GD: [0.08, 0.35],
  LP: [0.15, 0.5],
};

/** Auflösung der entzerrten Karte: 6 Pixel je Millimeter (63 × 88 mm); Abnutzung ist oft unter 1 mm breit. */
const MM = 6;
const CARD_W = 63 * MM;
const CARD_H = 88 * MM;
/** Rand um die entzerrte Karte, um den Hintergrund zu prüfen. */
const PAD = 4 * MM;
const CORNER_RADIUS = 3 * MM;
/**
 * Kantenstreifen: die äußeren 1,5 mm. Abnutzung sitzt direkt an der Kante; dass sich die äußersten
 * Pixel mit der Unterlage mischen, fängt der Vergleich mit der Helligkeit der Unterlage ab.
 */
const RING_INNER = 0;
const RING_OUTER = 1.5 * MM;
/** Ecke = Kantenstreifen innerhalb von 6 mm zur Ecke. */
const CORNER_ZONE = 6 * MM;

export function toGray(img: Pixels): Gray {
  const { width, height, channels: c, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += c) out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return { data: out, width, height };
}

function sample(g: Gray, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(g.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(g.height - 1, Math.floor(y)));
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const d = g.data;
  const top = d[y0 * g.width + x0] * (1 - fx) + d[y0 * g.width + x1] * fx;
  const bottom = d[y1 * g.width + x0] * (1 - fx) + d[y1 * g.width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Verkleinert/vergrößert mit Mittelung über den Quellbereich (kein Aliasing beim Verkleinern). */
export function resizeGray(g: Gray, width: number, height: number): Gray {
  const out = new Float32Array(width * height);
  const sx = g.width / width;
  const sy = g.height / height;
  const n = Math.max(1, Math.ceil(Math.max(sx, sy)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s += sample(g, (x + (i + 0.5) / n) * sx - 0.5, (y + (j + 0.5) / n) * sy - 0.5);
      out[y * width + x] = s / (n * n);
    }
  }
  return { data: out, width, height };
}

// --- Kanten finden -------------------------------------------------------------------------

interface Line {
  /** Position quer zur Kante als Funktion der Position entlang der Kante: s = a·t + b */
  a: number;
  b: number;
}

/**
 * Robuste Geradenanpassung: die Gerade durch zwei Punkte, der die meisten Punkte auf 1,5 Pixel
 * folgen, danach kleinste Quadrate über diese Punkte. Punkte von Linien im Kartenbild fallen so heraus.
 */
const INLIER_PX = 1.5;
function fitLine(points: { t: number; s: number }[]): { line: Line; inliers: number } | null {
  if (points.length < 6) return null;
  const count = (l: Line) => points.filter((p) => Math.abs(p.s - (l.a * p.t + l.b)) <= INLIER_PX);
  let kept: { t: number; s: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = (points[j].s - points[i].s) / (points[j].t - points[i].t);
      const inl = count({ a, b: points[i].s - a * points[i].t });
      if (inl.length > kept.length) kept = inl;
    }
  }
  if (kept.length < 6) return null;
  const n = kept.length;
  let st = 0, ss = 0, stt = 0, sts = 0;
  for (const p of kept) {
    st += p.t;
    ss += p.s;
    stt += p.t * p.t;
    sts += p.t * p.s;
  }
  const den = n * stt - st * st;
  const a = den ? (n * sts - st * ss) / den : 0;
  const line = { a, b: (ss - a * st) / n };
  return { line, inliers: count(line).length / points.length };
}

/**
 * Sucht eine Kartenkante. side: 0 oben, 1 rechts, 2 unten, 3 links.
 * Entlang vieler Schnitte quer zur Kante wird der äußerste starke Helligkeitssprung genommen
 * (von außen nach innen gesucht, damit Rahmenlinien im Kartenbild nicht gewinnen).
 */
function findEdge(g: Gray, expected: Rect, side: number): Line | null {
  const horizontal = side === 0 || side === 2;
  const along0 = horizontal ? expected.x : expected.y;
  const alongLen = horizontal ? expected.width : expected.height;
  const across = side === 0 ? expected.y : side === 1 ? expected.x + expected.width : side === 2 ? expected.y + expected.height : expected.x;
  const range = 0.1 * expected.height;
  const lo = Math.max(3, Math.floor(across - range));
  const hi = Math.min((horizontal ? g.height : g.width) - 4, Math.ceil(across + range));
  if (hi - lo < 6) return null;
  const outward = side === 0 || side === 3 ? -1 : 1;
  const value = (t: number, s: number) => {
    // Mittel über ±2 Pixel entlang der Kante gegen Rauschen
    let v = 0;
    for (let k = -2; k <= 2; k++) v += horizontal ? sample(g, t + k, s) : sample(g, s, t + k);
    return v / 5;
  };
  const points: { t: number; s: number }[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = along0 + alongLen * (0.15 + (0.7 * i) / steps);
    const profile: number[] = [];
    for (let s = lo - 3; s <= hi + 3; s++) profile.push(value(t, s));
    const grad: number[] = [];
    for (let s = lo; s <= hi; s++) {
      const k = s - lo + 3;
      grad.push(Math.abs((profile[k + 1] + profile[k + 2] + profile[k + 3]) - (profile[k - 1] + profile[k - 2] + profile[k - 3])) / 3);
    }
    const max = Math.max(...grad);
    if (max < 12) continue;
    // Von außen nach innen: erster deutliche Sprung, dann dessen Gipfel. Absichtlich nicht der stärkste:
    // die Kartenkante gegen den Tisch ist oft schwächer als Linien im Kartenbild.
    const order = outward < 0 ? grad.map((_, k) => k) : grad.map((_, k) => grad.length - 1 - k);
    let pick = -1;
    for (const k of order) {
      if (grad[k] >= Math.max(10, 0.15 * max)) {
        pick = k;
        while (true) {
          const next = pick - outward;
          if (next < 0 || next >= grad.length || grad[next] < grad[pick]) break;
          pick = next;
        }
        break;
      }
    }
    if (pick < 0) continue;
    // Subpixel per Parabel
    let offset = 0;
    if (pick > 0 && pick < grad.length - 1) {
      const l = grad[pick - 1], c = grad[pick], r = grad[pick + 1];
      const den = l - 2 * c + r;
      if (den < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den));
    }
    // Gradient sitzt zwischen s und s+1
    points.push({ t, s: lo + pick + offset + 0.5 });
  }
  const res = fitLine(points);
  if (!res || res.inliers < 0.7 || points.length < steps * 0.5) return null;
  return res.line;
}

function intersect(h: Line, v: Line): Point {
  // h: y = a·x + b, v: x = c·y + d
  const y = (h.a * v.b + h.b) / (1 - h.a * v.a);
  return { x: v.a * y + v.b, y };
}

/** Findet die vier Ecken der Karte in der Nähe des erwarteten Rechtecks (Zielrahmen). */
export function findCard(g: Gray, expected: Rect): Quad | null {
  const lines = [0, 1, 2, 3].map((side) => findEdge(g, expected, side));
  if (lines.some((l) => !l)) return null;
  const [top, right, bottom, left] = lines as Line[];
  const quad: Quad = [intersect(top, left), intersect(top, right), intersect(bottom, right), intersect(bottom, left)];
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const aspect = w / h;
  if (Math.abs(aspect / (63 / 88) - 1) > 0.08) return null;
  if (Math.abs(h / expected.height - 1) > 0.2) return null;
  // Das Handy liegt beim Scannen fast parallel zur Karte: Ecken müssen nahezu rechtwinklig sein.
  // Schiefe Vierecke entstehen, wenn eine Kante nicht sauber gefunden wurde; dann lieber keine Schätzung.
  for (let i = 0; i < 4; i++) {
    const p = quad[i], a = quad[(i + 3) % 4], b = quad[(i + 1) % 4];
    const cos = ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (dist(a, p) * dist(b, p));
    if (Math.abs(cos) > Math.sin((4 * Math.PI) / 180)) return null;
  }
  return quad;
}

// --- Entzerren -------------------------------------------------------------------------------

/** Projektive Abbildung Einheitsquadrat → Viereck (Heckbert). */
export function squareToQuad(q: Quad): number[] {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** Entzerrt die Karte auf CARD_W × CARD_H plus PAD Rand je Seite (2×2 Abtastungen je Pixel). */
export function warpCard(g: Gray, quad: Quad): Gray {
  const m = squareToQuad(quad);
  const W = CARD_W + 2 * PAD;
  const H = CARD_H + 2 * PAD;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const u = (x - PAD + 0.25 + 0.5 * i) / CARD_W;
          const v = (y - PAD + 0.25 + 0.5 * j) / CARD_H;
          const w = m[6] * u + m[7] * v + 1;
          s += sample(g, (m[0] * u + m[1] * v + m[2]) / w - 0.5, (m[3] * u + m[4] * v + m[5]) / w - 0.5);
        }
      }
      out[y * W + x] = s / 4;
    }
  }
  return { data: out, width: W, height: H };
}

// --- Vergleich mit dem Original ----------------------------------------------------------------

/** Abstand eines Kartenpixels (Kartenkoordinaten) zur Kante der abgerundeten Karte; negativ = außerhalb. */
function insideDistance(x: number, y: number): number {
  const r = CORNER_RADIUS;
  const cx = Math.min(Math.max(x, r), CARD_W - r);
  const cy = Math.min(Math.max(y, r), CARD_H - r);
  if (cx === x || cy === y) return Math.min(x, y, CARD_W - x, CARD_H - y);
  return r - Math.hypot(x - cx, y - cy);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function classify(edge: number, corner: number, t: ConditionThresholds = DEFAULT_THRESHOLDS): Exclude<Condition, 'PO'> {
  for (const c of ['NM', 'EX', 'GD', 'LP'] as const) if (edge <= t[c][0] && corner <= t[c][1]) return c;
  return 'PL';
}

/** Deine Zustandsangabe zu einem Scan mit den gemessenen Abnutzungswerten. */
export interface ConditionFeedback {
  edge: number;
  corner: number;
  condition: Condition;
}

const rank = (c: Condition) => CONDITIONS.indexOf(c);

/** Schwellen mit Faktor: > 1 = nachsichtiger (mehr Abnutzung für dieselbe Stufe), < 1 = strenger. */
export function scaleThresholds(scale: number, t: ConditionThresholds = DEFAULT_THRESHOLDS): ConditionThresholds {
  const f = ([e, c]: [number, number]): [number, number] => [e * scale, c * scale];
  return { NM: f(t.NM), EX: f(t.EX), GD: f(t.GD), LP: f(t.LP) };
}

/**
 * Lernt aus deinen Zustandsangaben, wie streng die Schätzung sein soll: der Faktor auf alle Schwellen,
 * bei dem die geschätzten Stufen am wenigsten von deinen abweichen (je Stufe Unterschied ein Fehlerpunkt).
 * Bei Gleichstand der Faktor am nächsten an 1; ohne Angaben 1.
 */
export function learnConditionScale(feedback: ConditionFeedback[]): number {
  if (!feedback.length) return 1;
  const cost = (scale: number) => {
    const t = scaleThresholds(scale);
    return feedback.reduce((sum, f) => sum + Math.abs(rank(classify(f.edge, f.corner, t)) - rank(f.condition)), 0);
  };
  let best = 1;
  for (let k = -8; k <= 8; k++) {
    const scale = 2 ** (k / 4);
    const c = cost(scale), b = cost(best);
    if (c < b || (c === b && Math.abs(k) < Math.abs(Math.log2(best) * 4))) best = scale;
  }
  return best;
}

/**
 * Gleicht Helligkeit und Kontrast des Fotos an das Original an (Innenbereich) und probiert
 * kleine Verschiebungen, um Restfehler der Kantensuche auszugleichen.
 */
function alignToReference(card: Gray, ref: Gray) {
  const W = card.width;
  let best = { r: -1, a: 1, b: 0, dx: 0, dy: 0 };
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      let n = 0, sr = 0, sc = 0, srr = 0, scc = 0, src = 0;
      for (let y = Math.round(CARD_H * 0.08); y < CARD_H * 0.92; y += 5) {
        for (let x = Math.round(CARD_W * 0.08); x < CARD_W * 0.92; x += 5) {
          const r = ref.data[y * CARD_W + x];
          const c = card.data[(y + dy + PAD) * W + (x + dx + PAD)];
          n++;
          sr += r;
          sc += c;
          srr += r * r;
          scc += c * c;
          src += r * c;
        }
      }
      const cov = src / n - (sr / n) * (sc / n);
      const vr = srr / n - (sr / n) ** 2;
      const vc = scc / n - (sc / n) ** 2;
      const corr = cov / Math.sqrt(vr * vc || 1);
      if (corr > best.r) {
        const a = cov / (vr || 1);
        best = { r: corr, a, b: sc / n - a * (sr / n), dx, dy };
      }
    }
  }
  return best;
}

/** Rastergröße für den Schattenausgleich (4 mm). */
const LIGHT_CELL = 4 * MM;

/**
 * Rechnet einen Schatten heraus: Verhältnis Foto zu angeglichenem Original je 4-mm-Zelle im Innenbereich
 * (Median, nur Stellen, die im Original nicht fast schwarz sind), geglättet und bis an den Rand
 * fortgesetzt. Der Kantenstreifen fließt nicht ein, weiße Abnutzung dort bleibt also erhalten.
 * null, wenn die Beleuchtung gleichmäßig ist (höchstens 20 % Unterschied); dann bleibt alles wie bisher.
 */
function relight(card: Gray, ref: Gray, fit: { a: number; b: number; dx: number; dy: number }): Gray | null {
  const cols = Math.ceil(CARD_W / LIGHT_CELL), rows = Math.ceil(CARD_H / LIGHT_CELL);
  const W = card.width;
  const ratio = new Float32Array(cols * rows).fill(NaN);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const values: number[] = [];
    for (let y = r * LIGHT_CELL; y < Math.min(CARD_H * 0.92, (r + 1) * LIGHT_CELL); y += 2) {
      if (y < CARD_H * 0.08) continue;
      for (let x = q * LIGHT_CELL; x < Math.min(CARD_W * 0.92, (q + 1) * LIGHT_CELL); x += 2) {
        if (x < CARD_W * 0.08) continue;
        const p = fit.a * ref.data[y * CARD_W + x] + fit.b;
        const c = card.data[(y + fit.dy + PAD) * W + (x + fit.dx + PAD)];
        if (p > 40) values.push(c / p);
      }
    }
    if (values.length >= 8) ratio[r * cols + q] = median(values);
  }
  // Zellen ohne Messung (Rand, dunkle Stellen) von den Nachbarn übernehmen
  for (let pass = 0; pass < cols + rows && ratio.some(Number.isNaN); pass++) {
    const prev = Float32Array.from(ratio);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      if (!Number.isNaN(prev[r * cols + q])) continue;
      let s = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const rr = r + j, qq = q + i;
        if (rr < 0 || qq < 0 || rr >= rows || qq >= cols || Number.isNaN(prev[rr * cols + qq])) continue;
        s += prev[rr * cols + qq];
        n++;
      }
      if (n) ratio[r * cols + q] = s / n;
    }
  }
  if (ratio.some(Number.isNaN)) return null;
  let light = ratio;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += light[Math.min(rows - 1, Math.max(0, r + j)) * cols + Math.min(cols - 1, Math.max(0, q + i))];
      next[r * cols + q] = s / 9;
    }
    light = next;
  }
  const top = Math.max(...light);
  if (top <= 0 || Math.min(...light) / top > 0.8) return null;
  const out = new Float32Array(card.data.length);
  for (let y = 0; y < card.height; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y - PAD - fit.dy) / LIGHT_CELL - 0.5));
    const r0 = Math.floor(fy), r1 = Math.min(rows - 1, r0 + 1), ty = fy - r0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(cols - 1, Math.max(0, (x - PAD - fit.dx) / LIGHT_CELL - 0.5));
      const q0 = Math.floor(fx), q1 = Math.min(cols - 1, q0 + 1), tx = fx - q0;
      const l =
        (light[r0 * cols + q0] * (1 - tx) + light[r0 * cols + q1] * tx) * (1 - ty) +
        (light[r1 * cols + q0] * (1 - tx) + light[r1 * cols + q1] * tx) * ty;
      out[y * W + x] = Math.min(255, card.data[y * W + x] * (top / Math.max(0.05, l)));
    }
  }
  return { data: out, width: W, height: card.height };
}

/**
 * Schätzt den Zustand.
 * @param photo    Kamerabild (Graustufen) mit etwas Rand um die Karte
 * @param expected wo die Karte ungefähr liegt (Zielrahmen in Bildkoordinaten)
 * @param reference offizielles Kartenbild (Graustufen, beliebige Größe im Kartenformat)
 */
export function estimateCondition(
  photo: Gray,
  expected: Rect,
  reference: Gray,
  thresholds: ConditionThresholds = DEFAULT_THRESHOLDS,
): ConditionEstimate {
  const none = (reason: string, quad?: Quad, fit = 0): ConditionEstimate => ({ condition: null, reason, edge: 0, corner: 0, fit, quad });
  const found = findCard(photo, expected);
  if (!found) return none('Kartenkanten nicht gefunden, eine Unterlage mit anderem Farbton als der Kartenrand hilft');
  const ref = resizeGray(reference, CARD_W, CARD_H);
  // Karte kann auch auf dem Kopf liegen: beide Richtungen probieren
  const flipped: Quad = [found[2], found[3], found[0], found[1]];
  const candidates = [found, flipped].map((quad) => {
    const card = warpCard(photo, quad);
    return { quad, card, fit: alignToReference(card, ref) };
  });
  const chosen = candidates[0].fit.r >= candidates[1].fit.r ? candidates[0] : candidates[1];
  const { quad } = chosen;
  let { card, fit: best } = chosen;
  // Liegt ein Schatten auf der Karte, ihn herausrechnen und neu angleichen
  const relit = relight(card, ref, best);
  if (relit) {
    const fit = alignToReference(relit, ref);
    if (fit.r > best.r) ({ card, best } = { card: relit, best: fit });
  }
  const W = card.width;
  const at = (x: number, y: number) => card.data[(y + PAD) * W + (x + PAD)];

  // Hintergrund direkt neben der Karte: muss deutlich dunkler sein als Papierweiß
  const bg: number[] = [];
  for (let x = 0; x < W; x += 2) for (const y of [1, 2, card.height - 3, card.height - 2]) bg.push(card.data[y * W + x]);
  for (let y = 0; y < card.height; y += 2) for (const x of [1, 2, W - 3, W - 2]) bg.push(card.data[y * W + x]);
  const background = median(bg);

  if (best.r < 0.6 || best.a < 0.2) return none('Foto passt nicht genau genug zum Original (Spiegelung oder Hülle?)', quad, best.r);
  const white = best.a * 255 + best.b;
  if (background > best.b + best.a * 150) return none('Unterlage zu hell, bitte eine mittelgraue oder farbige Unterlage nehmen', quad, best.r);

  // Abgenutzte Pixel im Kantenstreifen: deutlich heller als das Original an dieser Stelle und heller
  // als die Unterlage (sonst wäre es nur der Übergang zum Tisch)
  const threshold = 0.18 * (white - best.b);
  const minWhite = Math.max(best.b + best.a * 120, background + 0.15 * (white - best.b));
  const isWhite = new Uint8Array(CARD_W * CARD_H);
  for (let y = 0; y < CARD_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      const d = insideDistance(x + 0.5, y + 0.5);
      if (d < RING_INNER - 1 || d >= RING_OUTER + 1) continue;
      const c = at(x + best.dx, y + best.dy);
      const p = best.a * ref.data[y * CARD_W + x] + best.b;
      if (c - p > threshold && c > minWhite) isWhite[y * CARD_W + x] = 1;
    }
  }
  const corners = [0, 0, 0, 0];
  const cornerTotal = [0, 0, 0, 0];
  let edgeWhite = 0, edgeTotal = 0;
  for (let y = 0; y < CARD_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      const d = insideDistance(x + 0.5, y + 0.5);
      if (d < RING_INNER || d >= RING_OUTER) continue;
      // Einzelne Pixel sind meist Rauschen: zählt nur mit weißem Nachbarn
      let w = 0;
      if (isWhite[y * CARD_W + x]) {
        for (let j = -1; j <= 1 && !w; j++) for (let i = -1; i <= 1; i++) {
          const nx = x + i, ny = y + j;
          if ((i || j) && nx >= 0 && ny >= 0 && nx < CARD_W && ny < CARD_H && isWhite[ny * CARD_W + nx]) { w = 1; break; }
        }
      }
      const nearX = x < CORNER_ZONE ? 0 : x >= CARD_W - CORNER_ZONE ? 1 : -1;
      const nearY = y < CORNER_ZONE ? 0 : y >= CARD_H - CORNER_ZONE ? 1 : -1;
      if (nearX >= 0 && nearY >= 0) {
        const k = nearY * 2 + nearX;
        corners[k] += w;
        cornerTotal[k]++;
      } else {
        edgeWhite += w;
        edgeTotal++;
      }
    }
  }
  const edge = edgeWhite / (edgeTotal || 1);
  const corner = Math.max(...corners.map((c, k) => c / (cornerTotal[k] || 1)));
  return { condition: classify(edge, corner, thresholds), edge, corner, fit: best.r, quad };
}

/** Bereich um den Zielrahmen, der für die Zustandsschätzung aufgenommen wird (Anteil der Rahmenhöhe je Seite). */
export const CONDITION_MARGIN = 0.12;
