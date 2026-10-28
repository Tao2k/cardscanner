import type { FunctionComponent } from 'preact';
import type { Motif } from './binderThemes';

/**
 * Dezentes Motiv auf dem Deckel, hinter Titel und Karte. Zeichnet in der Zweitfarbe des Sets (currentColor)
 * und halbdurchsichtigem Weiß; 100 × 128 entspricht ungefähr dem Seitenformat.
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

/** Origins: Siegelkreis mit den sechs Runen (Domänen) um die Karte. */
function Sigil() {
  const triangle = (from: number) => `M${ring(3, 120, from).map((d) => at(37.5, d)).join('L')}Z`;
  const ticks = ring(36)
    .filter((d) => (d + 90) % 60 !== 0)
    .map((d) => `M${at(42.6, d)}L${at(44.6, d)}`)
    .join('');
  return (
    <>
      <g fill="none" stroke="currentColor">
        <circle cx={CX} cy={CY} r="41" stroke-width="0.55" opacity="0.6" />
        <circle cx={CX} cy={CY} r="37.5" stroke-width="0.3" opacity="0.45" />
        <circle cx={CX} cy={CY} r="23.5" stroke-width="0.45" opacity="0.45" />
        <path d={triangle(-90) + triangle(90)} stroke-width="0.35" opacity="0.4" />
        <path d={ticks} stroke-width="0.35" opacity="0.5" />
      </g>
      <g fill="currentColor" opacity="0.7">
        {ring(6, 60, -90).map((d) => {
          const [x, y] = pt(41, d);
          return <circle cx={x} cy={y} r="1.9" />;
        })}
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
        <circle cx={CX} cy={CY} r="44" stroke-width="0.5" stroke-dasharray="1.2 2" />
        <circle cx={CX} cy={CY} r="40" stroke-width="0.3" />
        <circle cx={CX} cy={CY} r="31" stroke-width="0.3" stroke-dasharray="0.6 1.4" />
      </g>
      <g transform="translate(50 115) scale(0.26)" fill="currentColor" fill-opacity="0.3" stroke="currentColor" stroke-width="1.2" stroke-opacity="0.7">
        <Sword angle={-42} />
        <Sword angle={42} />
      </g>
    </>
  );
}

const leaf = (len: number) => `M0 0C4.6 ${-len * 0.3} 4.2 ${-len * 0.72} 0 ${-len}C-4.2 ${-len * 0.72} -4.6 ${-len * 0.3} 0 0Z`;
const PETALS = [
  [16, 18, 30, 1.2],
  [84, 13, -20, 1],
  [92, 46, 60, 0.85],
  [13, 60, 120, 0.9],
  [88, 86, 200, 1.1],
  [20, 104, 80, 0.85],
  [78, 113, -40, 0.95],
  [57, 122, 150, 0.75],
  [38, 9, 10, 0.7],
];

/** Spiritforged: Irelias schwebende Klingen als Fächer, dazu Blütenblätter (Spirit Blossom). */
function Blades() {
  return (
    <>
      <g fill="#fff" fill-opacity="0.08" stroke="currentColor" stroke-width="0.4" stroke-opacity="0.6">
        {[-64, -32, 0, 32, 64].map((d) => (
          <g transform={`translate(${CX} 84) rotate(${d}) translate(0 -10)`}>
            <path d={leaf(46)} />
            <path d="M0-3V-42" fill="none" stroke-width="0.25" />
          </g>
        ))}
      </g>
      <g fill="currentColor" opacity="0.6">
        {PETALS.map(([x, y, r, s]) => (
          <path transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} d="M0 0C1.6-2.2 4.4-2.4 5.4 0 4.4 2.4 1.6 2.2 0 0z" />
        ))}
      </g>
    </>
  );
}

const LEAF = 'M0 0C8-9 22-12 38-6 24-1 10 2 0 0z';
const RIB = 'M2-.6C14-4.5 26-6 36-5.8';
const slash = (len: number) => `M0 0Q${len / 2} -8 ${len} 0Q${len / 2} -1.6 0 0z`;

/** Unleashed: Blätter des Dschungels als Schatten, Krallenspuren (Rengar). */
function Claws() {
  return (
    <>
      <g fill="#000" fill-opacity="0.2" stroke="#000" stroke-opacity="0.12" stroke-width="0.5">
        {[
          'translate(7 128) rotate(-62) scale(1.15)',
          'translate(7 128) rotate(-28) scale(0.9)',
          'translate(9 0) rotate(40) scale(0.85)',
          'translate(100 2) rotate(150) scale(0.75)',
        ].map((t) => (
          <g transform={t}>
            <path d={LEAF} stroke="none" />
            <path d={RIB} fill="none" />
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

/** Vendetta: Bruder gegen Bruder, der Deckel geteilt, dazwischen Shurimas Sonnenscheibe. */
function Rivals() {
  return (
    <>
      <defs>
        <linearGradient id="motif-rival-shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.45" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.45" />
        </linearGradient>
      </defs>
      <path class="motif-rival" d="M100 0V128H0z" />
      <path d="M100 0V128H0z" fill="url(#motif-rival-shade)" />
      <path d="M100 0 0 128" stroke="currentColor" stroke-width="0.7" opacity="0.85" />
      <g fill="none" stroke="currentColor" opacity="0.5">
        <circle cx={CX} cy={CY} r="27" stroke-width="0.55" />
        <circle cx={CX} cy={CY} r="24.5" stroke-width="0.3" />
        <path d={ring(24).map((d, k) => `M${at(29.5, d)}L${at(k % 2 ? 32.5 : 35.5, d)}`).join('')} stroke-width="0.45" />
      </g>
    </>
  );
}

const sparkle = 'M0-1C.12-.12.12-.12 1 0 .12.12.12.12 0 1-.12.12-.12.12-1 0-.12-.12-.12-.12 0-1z';
const SPARKLES: [number, number, number, boolean][] = [
  [20, 18, 4, true],
  [82, 26, 2.6, false],
  [88, 96, 3.4, true],
  [15, 92, 2.8, false],
  [72, 12, 1.8, true],
  [28, 114, 2, true],
  [80, 116, 1.6, false],
  [12, 48, 1.8, false],
  [90, 58, 1.6, true],
];
const GLITTER = [
  [30, 8],
  [44, 18],
  [92, 12],
  [8, 30],
  [94, 38],
  [10, 74],
  [94, 76],
  [22, 82],
  [84, 106],
  [40, 120],
  [62, 110],
  [18, 124],
  [70, 30],
];

/** Radiance: Scheinwerfer auf der Bühne, Funkeln und Glitzer. */
function Stage() {
  return (
    <>
      <defs>
        <linearGradient id="motif-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.3" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="M14-2h8l44 120H36z" fill="url(#motif-beam)" />
      <path d="M78-2h8L64 118H34z" fill="url(#motif-beam)" />
      <ellipse cx={CX} cy="131" rx="48" ry="14" fill="#fff" opacity="0.1" />
      {SPARKLES.map(([x, y, s, accent]) => (
        <path transform={`translate(${x} ${y}) scale(${s})`} d={sparkle} fill={accent ? 'currentColor' : '#fff'} opacity={accent ? 0.85 : 0.6} />
      ))}
      <g fill="#fff" opacity="0.55">
        {GLITTER.map(([x, y], k) => (
          <circle cx={x} cy={y} r={0.4 + (k % 3) * 0.15} />
        ))}
      </g>
    </>
  );
}

const ART: Record<Motif, FunctionComponent> = { sigil: Sigil, arena: Arena, blades: Blades, claws: Claws, rivals: Rivals, stage: Stage };
