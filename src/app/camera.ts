import { boxToVideo, guideRect } from '../core/geometry';
import type { Pixels } from '../core/imageops';

/** Kantenlänge (Höhe) des Ausschnitts, der an die Erkennung geht. Größer bringt nichts, das Modell rechnet mit 224 px. */
const CROP_HEIGHT = 320;

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Zeichnet den Bereich des Zielrahmens in voller Kameraauflösung (höchstens maxHeight) auf ein Canvas. */
export function drawCard(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxHeight: number): CanvasRenderingContext2D | null {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return null;
  const src = boxToVideo(guideRect(clientWidth, clientHeight), videoWidth, videoHeight, clientWidth, clientHeight);
  const height = Math.round(Math.min(maxHeight, src.height));
  const width = Math.round((src.width / src.height) * height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, src.x, src.y, src.width, src.height, 0, 0, width, height);
  return ctx;
}

/** Schneidet den Bereich des Zielrahmens für die Bilderkennung aus. */
export function grabCard(video: HTMLVideoElement, canvas: HTMLCanvasElement): Pixels | null {
  const ctx = drawCard(video, canvas, CROP_HEIGHT);
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width: canvas.width, height: canvas.height, channels: 4 };
}

/** Höhere Auflösung für die Texterkennung; Kartentext ist klein. */
export const OCR_CROP_HEIGHT = 1100;
