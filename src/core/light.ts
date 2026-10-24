import type { Pixels } from './imageops';

/** Mittlere Helligkeit (0 = schwarz, 1 = weiß) nach BT.601; jedes step-te Pixel reicht dafür. */
export function meanLuma(pixels: Pixels, step = 4): number {
  const { data, width, height, channels } = pixels;
  const n = width * height;
  if (!n || channels < 3) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * channels;
    sum += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    count++;
  }
  return sum / count / 255;
}

export interface AutoTorchConfig {
  /** Darunter (Median der letzten Frames) gilt das Bild als zu dunkel. */
  darkBelow: number;
  /** So viele Frames fließen in den Median. */
  window: number;
  /** So lange (ms) muss es durchgehend zu dunkel sein, bevor das Licht angeht. */
  darkForMs: number;
  /** Nach dem Kamerastart so lange (ms) nichts entscheiden; die Belichtung regelt sich erst ein. */
  warmUpMs: number;
}

/**
 * Schätzwert, noch nicht an echten Handyfotos kalibriert: Die Belichtungsautomatik hellt dunkle Räume stark auf, ein Median
 * unter 0,22 heißt dann verrauschtes, kontrastarmes Bild, bei dem die Erkennung kaum noch trifft.
 * Gemessen wird das ganze Kamerabild, nicht nur der Zielrahmen: Eine dunkle Karte (schwarzer Rand,
 * dunkles Motiv) soll das Licht nicht auslösen.
 */
export const DEFAULT_AUTO_TORCH: AutoTorchConfig = { darkBelow: 0.22, window: 6, darkForMs: 1200, warmUpMs: 1500 };

/**
 * Entscheidet anhand der Bildhelligkeit, ob das Licht angehen soll. Ist es einmal an, bleibt es an,
 * bis der Scan endet: Mit Licht ist das Bild hell, daraus lässt sich nicht ablesen, ob es ohne
 * reichen würde. Ausschalten nach Helligkeit würde nur flackern.
 */
export class AutoTorch {
  private lumas: number[] = [];
  private startedAt = 0;
  private darkSince: number | null = null;
  private fired = false;

  constructor(private readonly config: AutoTorchConfig = DEFAULT_AUTO_TORCH) {}

  reset(now: number) {
    this.lumas = [];
    this.startedAt = now;
    this.darkSince = null;
    this.fired = false;
  }

  /** Ist das Bild gerade zu dunkel (Median der letzten Frames)? */
  get dark(): boolean {
    return this.lumas.length >= this.config.window && median(this.lumas) < this.config.darkBelow;
  }

  /** Neuer Frame; true genau einmal, wenn das Licht automatisch angehen soll. */
  push(luma: number, now: number): boolean {
    this.lumas = [...this.lumas, luma].slice(-this.config.window);
    if (this.fired || now - this.startedAt < this.config.warmUpMs) return false;
    if (!this.dark) {
      this.darkSince = null;
      return false;
    }
    this.darkSince ??= now;
    if (now - this.darkSince < this.config.darkForMs) return false;
    this.fired = true;
    return true;
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
