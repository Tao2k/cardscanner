import type { Worker } from 'tesseract.js';
import { TEXT_REGION } from '../core/language';

/**
 * Texterkennung für die Spracherkennung, ein Modell je Schrift: Französisch (liest auch Englisch,
 * inkl. Akzente) und vereinfachtes Chinesisch. Die Sprachdaten lädt tesseract.js beim ersten
 * Gebrauch und hält sie im Browser-Cache.
 */
export const OCR_MODELS = { latin: 'fra', han: 'chi_sim' } as const;
export type Script = keyof typeof OCR_MODELS;

const workers = new Map<Script, Promise<Worker>>();

function worker(script: Script): Promise<Worker> {
  let w = workers.get(script);
  if (!w) {
    w = import('tesseract.js').then(({ createWorker }) => createWorker(OCR_MODELS[script], 1));
    w.catch(() => workers.delete(script));
    workers.set(script, w);
  }
  return w;
}

/** Startet die Texterkennung im Hintergrund, damit der erste Treffer nicht warten muss. */
export function warmUpOcr(scripts: Script[] = ['latin', 'han']) {
  for (const s of scripts) worker(s).catch(() => undefined);
}

/** Schneidet das Textfeld der Karte aus (Name + Regeltext). */
export function cropTextRegion(card: HTMLCanvasElement, target: HTMLCanvasElement): HTMLCanvasElement {
  const x = Math.round(card.width * TEXT_REGION.left);
  const y = Math.round(card.height * TEXT_REGION.top);
  target.width = Math.round(card.width * (TEXT_REGION.right - TEXT_REGION.left));
  target.height = Math.round(card.height * (TEXT_REGION.bottom - TEXT_REGION.top));
  target.getContext('2d')!.drawImage(card, x, y, target.width, target.height, 0, 0, target.width, target.height);
  return target;
}

export async function readText(image: HTMLCanvasElement, script: Script, timeoutMs = 4000): Promise<string> {
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), timeoutMs));
  const work = worker(script)
    .then((w) => w.recognize(image))
    .then((r) => r.data.text)
    .catch(() => '');
  return Promise.race([work, timeout]);
}
