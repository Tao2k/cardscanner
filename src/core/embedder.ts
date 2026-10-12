import { l2normalize } from './matcher';
import { letterboxToSquare, toPortrait, type Pixels } from './imageops';

/**
 * Bildmodell für die Erkennung. Katalog-Build und App müssen exakt dasselbe Modell
 * mit derselben Quantisierung verwenden, sonst passen die Vektoren nicht zusammen.
 */
export const MODEL_ID = 'Xenova/dinov2-small';
export const MODEL_DTYPE = 'q8';

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
  const { AutoModel, AutoProcessor, RawImage, env } = await import('@huggingface/transformers');
  if (options.localModelPath) {
    env.localModelPath = options.localModelPath;
    env.allowLocalModels = true;
  }
  if (options.cacheDir) env.cacheDir = options.cacheDir;

  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, {
    dtype: MODEL_DTYPE,
    ...(options.device ? { device: options.device } : {}),
  });

  return {
    model: `${MODEL_ID}@${MODEL_DTYPE}`,
    async embed(img: Pixels): Promise<Float32Array> {
      const square = letterboxToSquare(toPortrait(img));
      const raw = new RawImage(square.data, square.width, square.height, 3);
      const inputs = await processor(raw);
      const output = await model(inputs);
      // DINOv2: Klassen-Token (Position 0) der letzten Schicht als Bildvektor.
      const pooled = output.pooler_output ?? output.last_hidden_state.slice(null, 0, null);
      return l2normalize(Float32Array.from(pooled.data as Float32Array));
    },
  };
}
