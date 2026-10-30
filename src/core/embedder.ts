import { l2normalize } from './matcher';
import { letterboxToSquare, toPortrait, type Pixels } from './imageops';

/**
 * Bildmodell für die Erkennung. Katalog-Build und App müssen exakt dasselbe Modell mit derselben
 * Quantisierung und Vorverarbeitung verwenden, sonst passen die Vektoren nicht zusammen.
 * Verglichen mit `npm run bench` (scripts/bench-recognition.ts).
 */
export interface ModelSpec {
  id: string;
  dtype: 'q8' | 'fp16' | 'fp32';
  /** dino: Klassen-Token, siglip: gepoolter Bildvektor */
  kind: 'dino' | 'siglip';
  /**
   * Gewicht des Pixelvergleichs beim Nachsortieren der besten Treffer (0 = aus).
   * Die Korrelation (−1 bis 1) wird mit diesem Faktor zur Bildähnlichkeit addiert.
   */
  rerank: number;
}

/**
 * DINOv3 ViT-S/16 (August 2025), gleich groß und schnell wie das frühere DINOv2-small.
 * Gemessen auf 400 schweren Testfotos (npm run bench, Oktober 2026), mit Entzerren und Pixelvergleich 0.2:
 * Top-1 93,5 % (DINOv2-small vorher 69 %), automatisch speicherbar bei ≥ 95 % richtig: 93 % (vorher 54 %).
 */
export const MODEL: ModelSpec = { id: 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX', dtype: 'q8', kind: 'dino', rerank: 0.2 };
export const MODEL_ID = MODEL.id;
/**
 * Kennung von Modell und Vorverarbeitung; steht im Katalog und an eigenen Scans. Ändert sie sich,
 * passen alte Lernfotos nicht mehr und werden ignoriert. „/full“: ganzes Quadrat statt Mitte ausschneiden.
 */
export const MODEL_KEY = `${MODEL.id}@${MODEL.dtype}/full`;
/** Kennung der Scans, die vor dem Wechsel gespeichert wurden (ohne Angabe). */
export const LEGACY_MODEL_KEY = 'Xenova/dinov2-small@q8';

export interface Embedder {
  model: string;
  embed(img: Pixels): Promise<Float32Array>;
}

export interface EmbedderOptions {
  /** Pfad, unter dem das Modell selbst gehostet wird (z. B. `${BASE_URL}models/`). */
  localModelPath?: string;
  /** Nur im Katalog-Build: Ablage für heruntergeladene Modelldateien. */
  cacheDir?: string;
  device?: 'wasm' | 'webgpu' | 'cpu';
}

export async function createEmbedder(options: EmbedderOptions = {}): Promise<Embedder> {
  const t = await import('@huggingface/transformers');
  const { AutoModel, AutoProcessor, RawImage, SiglipVisionModel, env } = t;
  if (options.localModelPath) {
    env.localModelPath = options.localModelPath;
    env.allowLocalModels = true;
  }
  if (options.cacheDir) env.cacheDir = options.cacheDir;

  const processor = await AutoProcessor.from_pretrained(MODEL.id);
  // Ganzes (aufgefülltes) Quadrat auf 224 px statt Mitte ausschneiden: sonst fehlen oben Name und
  // Kosten, unten die Sammlernummer (bei DINOv2 gemessen: Top-1 70 % → 79 %).
  const ip = (processor as unknown as { image_processor: Record<string, unknown> }).image_processor;
  ip.do_center_crop = false;
  ip.size = { height: 224, width: 224 };
  const Model = MODEL.kind === 'siglip' ? SiglipVisionModel : AutoModel;
  const model = await (Model as typeof AutoModel).from_pretrained(MODEL.id, {
    dtype: MODEL.dtype,
    ...(options.device ? { device: options.device } : {}),
  });

  return {
    model: MODEL_KEY,
    async embed(img: Pixels): Promise<Float32Array> {
      const square = letterboxToSquare(toPortrait(img));
      const raw = new RawImage(square.data, square.width, square.height, 3);
      const output = await model(await processor(raw));
      if (MODEL.kind === 'siglip') return l2normalize(Float32Array.from(output.pooler_output.data as Float32Array));
      // DINO: Klassen-Token (Position 0) der letzten Schicht als Bildvektor (Register-Token danach bleiben außen vor).
      const dim = output.last_hidden_state.dims.at(-1) as number;
      return l2normalize(Float32Array.from((output.last_hidden_state.data as Float32Array).subarray(0, dim)));
    },
  };
}
