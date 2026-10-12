import type { Worker } from 'tesseract.js';

/**
 * Texterkennung für die Spracherkennung. Französisches Modell (liest auch Englisch, inkl. Akzente)
 * plus vereinfachtes Chinesisch. Die Sprachdaten lädt tesseract.js beim ersten Gebrauch
 * und hält sie im Browser-Cache.
 */
export const OCR_LANGS = ['fra', 'chi_sim'];

let worker: Promise<Worker> | null = null;

/** Startet die Texterkennung im Hintergrund, damit der erste Treffer nicht warten muss. */
export function warmUpOcr(): Promise<Worker> {
  worker ??= import('tesseract.js').then(({ createWorker }) => createWorker(OCR_LANGS, 1));
  worker.catch(() => (worker = null));
  return worker;
}

export async function readText(canvas: HTMLCanvasElement, timeoutMs = 5000): Promise<string> {
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), timeoutMs));
  const work = warmUpOcr()
    .then((w) => w.recognize(canvas))
    .then((r) => r.data.text)
    .catch(() => '');
  return Promise.race([work, timeout]);
}
