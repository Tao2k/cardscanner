import type { FunctionComponent } from 'preact';
import type { Motif } from './binderThemes';

/**
 * Dezentes Motiv auf dem Deckel, hinter Titel und Karte. Zeichnet in der Akzentfarbe des Sets (currentColor),
 * der Zweitfarbe (Klasse second) und halbdurchsichtigem Weiß; 100 × 128 entspricht ungefähr dem Seitenformat.
 */
export function CoverMotif({ motif }: { motif: Motif }) {
  const Art = ART[motif];
  return (
    <svg class="cover-motif" viewBox="0 0 100 128" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Art />
    </svg>
  );
}

/** Mitte hinter der Karte auf dem Deckel. */
const CX = 50;
const CY = 66;
/** Punkt auf einem Kreis um die Mitte (Winkel in Grad, 0 = rechts, im Uhrzeigersinn). */
const pt = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [+(CX + r * Math.cos(a)).toFixed(2), +(CY + r * Math.sin(a)).toFixed(2)];
};
const at = (r: number, deg: number) => pt(r, deg).join(' ');
const ring = (count: number, step = 360 / count, from = 0) => Array.from({ length: count }, (_, k) => from + k * step);

/** Ring um die Karte: knapp unter dem Titel und über „Öffnen“. */
const RIM = 25.5;

/** Origins: goldener Ring mit hellem Wirbel, wie hinter Ahri, Yasuo und Jinx auf der Key Art. */
function Portal() {
  const swirl = ring(9).map((d) => `M${at(11, d)}Q${at(21, d + 30)} ${at(25.6, d + 75)}`).join('');
  return (
    <>
      <defs>
        <radialGradient id="motif-portal">
          <stop offset="0" stop-color="#7cc4ec" stop-opacity="0.34" />
          <stop offset="0.9" stop-color="#3d8fc0" stop-opacity="0.2" />
          <stop offset="1" stop-color="#3d8fc0" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r="26.4" fill="url(#motif-portal)" />
      <path d={swirl} fill="none" stroke="#fff" stroke-width="0.45" opacity="0.16" />
      <g fill="none" stroke="currentColor">
        <circle cx={CX} cy={CY} r={RIM} stroke-width="0.7" opacity="0.9" />
        <circle cx={CX} cy={CY} r="27.3" stroke-width="0.25" opacity="0.55" />
      </g>
    </>
  );
}

function Sword({ angle }: { angle: number }) {
  return (
    <g transform={`rotate(${angle})`}>
      <path d="M0-47 2.4-41V17h-4.8V-41z" />
      <path d="M0-39V14" fill="none" stroke-width="0.3" />
      <rect x="-9.5" y="17" width="19" height="3" rx="1.5" />
      <rect x="-1.5" y="20" width="3" height="10" rx="1" />
      <circle cy="32.6" r="2.6" />
    </g>
  );
}

/** Proving Grounds: Ränge der Arena um die Karte, unten gekreuzte Schwerter als Wappen. */
function Arena() {
  return (
    <>
      <g fill="none" stroke="currentColor" opacity="0.45">
        <circle cx={CX} cy={CY} r="47" stroke-width="0.3" />
        <circle cx={CX} cy={CY} r="44" stroke-width="0.5" stroke-dasharray="1.2 2" />
        <circle cx={CX} cy={CY} r={RIM} stroke-width="0.35" stroke-dasharray="0.6 1.4" />
      </g>
      <g transform="translate(50 113) scale(0.24)" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.2" stroke-opacity="0.7">
        <Sword angle={-42} />
        <Sword angle={42} />
      </g>
    </>
  );
}

/** Gold des Rings hinter den Champions in der Key Art */
const GOLD = '#c9a65e';

/** Sichel auf dem Kreis um die Mitte: außen der Kreisbogen, innen fast gerade. */
const crescent = (r: number, from: number, to: number) => `M${at(r, from)}A${r} ${r} 0 0 1 ${at(r, to)}A200 200 0 0 0 ${at(r, from)}z`;
const arc = (r: number, from: number, to: number) => `M${at(r, from)}A${r} ${r} 0 0 1 ${at(r, to)}`;
const PETALS = [
  [16, 18, 30, 1.2],
  [84, 13, -20, 1],
  [93, 50, 60, 0.85],
  [12, 62, 120, 0.9],
  [90, 88, 200, 1.1],
  [20, 98, 80, 0.85],
  [78, 120, -40, 0.95],
  [52, 124, 150, 0.75],
  [36, 10, 10, 0.7],
  [66, 8, 100, 0.8],
];

/** Irelias Band, unterhalb von Karte und „Öffnen“ */
const RIBBON = 'M-2 112C14 102 26 120 42 112S66 94 102 104';

/** Spiritforged: Irelias Stahlklingen kreisen um die Karte, dazu ein karminrotes Band, Blütenblätter und der goldene Ring. */
function Blades() {
  const blades = [35, 145, 215, 325].map((mid) => [mid - 26, mid + 26]);
  return (
    <>
      <circle cx={CX} cy={CY} r={RIM} fill="none" stroke={GOLD} stroke-width="0.45" opacity="0.85" />
      <g class="second" fill-opacity="0.6" stroke="#5e575c" stroke-opacity="0.45" stroke-width="0.4">
        {blades.map(([from, to]) => (
          <path d={crescent(46, from, to)} />
        ))}
      </g>
      <g fill="none" stroke="#fff" stroke-width="0.5" opacity="0.75">
        {blades.map(([from, to]) => (
          <path d={arc(46, from + 3, to - 3)} />
        ))}
      </g>
      <g fill="none" stroke-linecap="round">
        <path d={RIBBON} stroke="currentColor" stroke-width="2.4" opacity="0.6" />
        <path d={RIBBON} stroke="#f6b3c4" stroke-width="0.6" opacity="0.8" />
      </g>
      {PETALS.map(([x, y, r, s], k) => (
        <path
          transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}
          d="M0 0C1.6-2.2 4.4-2.4 5.4 0 4.4 2.4 1.6 2.2 0 0z"
          fill={k % 2 ? '#e497a7' : 'currentColor'}
          opacity="0.8"
        />
      ))}
    </>
  );
}

const LEAF = 'M0 0C8-9 22-12 38-6 24-1 10 2 0 0z';
const RIB = 'M2-.6C14-4.5 26-6 36-5.8';
const slash = (len: number) => `M0 0Q${len / 2} -8 ${len} 0Q${len / 2} -1.6 0 0z`;

/** Unleashed: dunkle Ranken mit Blättern wie am Rand des Boosters, Krallenspuren (Rengar). */
function Claws() {
  return (
    <>
      <g class="second-stroke" fill="none" stroke-width="0.9" stroke-linecap="round" opacity="0.8">
        <path d="M2 128C8 118 5 108 13 103S24 97 22 89c-.6-2.6 1.8-4.6 4-3.2" />
        <path d="M98 0C92 7 95 14 88 19S80 24 83 28c1.2 1.6 3.6.8 3.4-1" />
      </g>
      <g class="second" fill-opacity="0.65">
        {[
          'translate(7 128) rotate(-62) scale(1.15)',
          'translate(7 128) rotate(-28) scale(0.9)',
          'translate(9 0) rotate(40) scale(0.85)',
          'translate(100 2) rotate(150) scale(0.75)',
        ].map((t) => (
          <g transform={t}>
            <path d={LEAF} />
            <path d={RIB} fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="0.5" />
          </g>
        ))}
      </g>
      <g fill="#fff" opacity="0.17">
        {[
          [62, 121, 42],
          [69, 124, 46],
          [77, 126, 40],
        ].map(([x, y, len]) => (
          <path transform={`translate(${x} ${y}) rotate(-58)`} d={slash(len)} />
        ))}
      </g>
    </>
  );
}

type Pt = [number, number];
const cubic = (p: number, q: number, r: number, s: number, t: number) =>
  (1 - t) ** 3 * p + 3 * (1 - t) ** 2 * t * q + 3 * (1 - t) * t * t * r + t ** 3 * s;
const slope = (p: number, q: number, r: number, s: number, t: number) =>
  3 * (1 - t) ** 2 * (q - p) + 6 * (1 - t) * t * (r - q) + 3 * t * t * (s - r);

/**
 * Rauchfahne als Fläche um eine Mittellinie aus kubischen Bézierstücken (Start, Kontrolle, Kontrolle, Ende, Kontrolle, …).
 * Sie wird vom Schweif bis `peak` breiter und läuft zur Locke am Ende auf `end` der Breite aus.
 */
function wisp(points: Pt[], width: number, peak: number, end: number) {
  const STEPS = 14;
  const pieces = (points.length - 1) / 3;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pieces; i++) {
    const [a, b, c, d] = points.slice(i * 3, i * 3 + 4);
    for (let k = i ? 1 : 0; k <= STEPS; k++) {
      const t = k / STEPS;
      const [x, y] = [0, 1].map((n) => cubic(a[n], b[n], c[n], d[n], t));
      const [dx, dy] = [0, 1].map((n) => slope(a[n], b[n], c[n], d[n], t));
      const len = Math.hypot(dx, dy) || 1;
      const s = (i + t) / pieces;
      const half =
        (width / 2) * (s < peak ? Math.sin(((s / peak) * Math.PI) / 2) : end + (1 - end) * Math.cos((((s - peak) / (1 - peak)) * Math.PI) / 2));
      left.push([x - (dy / len) * half, y + (dx / len) * half]);
      right.push([x + (dy / len) * half, y - (dx / len) * half]);
    }
  }
  return `M${[...left, ...right.reverse()].map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
}

/** Grüner Rauch wie um Akali: unten quer über den Deckel, rechts hoch bis in die Ecke, links eine kleine Locke. */
const SMOKE: [Pt[], number, number, number][] = [
  [[[-8, 100], [4, 108], [14, 118], [30, 118], [44, 118], [56, 112], [68, 110], [80, 108], [88, 104], [90, 96], [92, 88], [84, 84], [80, 89], [78, 92], [82, 94], [84, 92]], 13, 0.4, 0.08],
  [[[63, 72], [70, 64], [75, 59], [80, 54], [88, 46], [92, 38], [90, 28], [88, 20], [80, 20], [80, 26], [80, 30], [85, 30], [85, 27]], 11, 0.35, 0.08],
  [[[37, 62], [31, 60], [24, 56], [18, 50], [12, 44], [12, 36], [18, 35], [23, 34], [24, 40], [20, 41]], 7, 0.3, 0.1],
  [[[-6, 18], [4, 22], [12, 20], [16, 14], [19, 9], [14, 6], [12, 9]], 4.5, 0.45, 0.1],
];
/** Schein, Körper und helle Oberkante des Rauchs */
const SMOKE_LAYERS = [1.25, 0.8, 0.3].map((scale) => SMOKE.map(([points, width, peak, end]) => wisp(points, width * scale, peak, end)).join(''));
const SHARDS = [
  [16, 22, 20, 1.6],
  [84, 14, -30, 1.2],
  [93, 66, 75, 1.4],
  [9, 86, 140, 1.2],
  [82, 116, 200, 1.5],
  [60, 15, 260, 1],
  [26, 120, 310, 1.1],
];

/** Vendetta: grüner Rauch um die Karte (Akali), goldener Ring, rosa Splitter. */
function Smoke() {
  const [halo, body, light] = SMOKE_LAYERS;
  return (
    <>
      <defs>
        <filter id="motif-halo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <filter id="motif-edge" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.35" />
        </filter>
      </defs>
      <path d={halo} class="second" opacity="0.45" filter="url(#motif-halo)" />
      <g filter="url(#motif-edge)">
        <path d={body} class="second" opacity="0.6" />
        <path d={light} fill="#c4f5b8" opacity="0.3" transform="translate(-0.3 -1)" />
      </g>
      <circle cx={CX} cy={CY} r={RIM} fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.9" />
      <g fill="#ff7aa6" opacity="0.6">
        {SHARDS.map(([x, y, r, s]) => (
          <path transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} d="M0-1.6 1.2 1.2-1.4.6z" />
        ))}
      </g>
    </>
  );
}

/** Schillernde Farben des Rings wie auf der Key Art */
const PRISM = ['#ff9ecf', '#ffc2a1', '#ffe58f', '#c9f29b', '#8ff0d1', '#8fd8ff', '#a9b6ff', '#d3a6ff'];
const sparkle = 'M0-1C.12-.12.12-.12 1 0 .12.12.12.12 0 1-.12.12-.12.12-1 0-.12-.12-.12-.12 0-1z';
const SPARKLES: [number, number, number, 'white' | 'second' | 'accent'][] = [
  [18, 16, 4, 'white'],
  [84, 24, 2.6, 'second'],
  [88, 100, 3.4, 'white'],
  [13, 94, 2.8, 'second'],
  [70, 11, 1.8, 'accent'],
  [28, 116, 2, 'accent'],
  [80, 118, 1.6, 'white'],
  [10, 46, 1.8, 'white'],
  [92, 60, 1.6, 'accent'],
];
const GLITTER = [
  [30, 8],
  [44, 18],
  [92, 12],
  [8, 30],
  [95, 40],
  [10, 74],
  [94, 78],
  [22, 84],
  [84, 108],
  [40, 121],
  [62, 112],
  [18, 124],
  [74, 30],
];

/** Radiance: schillernder Ring um die Karte, Funkeln und Glitzer (Seraphine). */
function Stage() {
  return (
    <>
      <g fill="none" stroke-width="2.6" opacity="0.8">
        {ring(12).map((d, k) => (
          <path d={arc(46, d, d + 30)} stroke={PRISM[k % PRISM.length]} />
        ))}
      </g>
      <g fill="none" stroke="#fff" opacity="0.8">
        <circle cx={CX} cy={CY} r="43" stroke-width="0.45" />
        <circle cx={CX} cy={CY} r="49.5" stroke-width="0.3" />
      </g>
      {SPARKLES.map(([x, y, s, tone]) => (
        <path
          transform={`translate(${x} ${y}) scale(${s})`}
          d={sparkle}
          class={tone === 'second' ? 'second' : undefined}
          fill={tone === 'white' ? '#fff' : tone === 'accent' ? 'currentColor' : undefined}
          opacity={tone === 'white' ? 0.95 : 0.8}
        />
      ))}
      <g fill="#fff" opacity="0.8">
        {GLITTER.map(([x, y], k) => (
          <circle cx={x} cy={y} r={0.4 + (k % 3) * 0.15} />
        ))}
      </g>
    </>
  );
}

const ART: Record<Motif, FunctionComponent> = { portal: Portal, arena: Arena, blades: Blades, claws: Claws, smoke: Smoke, stage: Stage };
