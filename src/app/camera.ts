import { boxToVideo, guideRect, type Rect } from '../core/geometry';
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
  return drawAroundCard(video, canvas, maxHeight, 0)?.ctx ?? null;
}

/**
 * Wie drawCard, aber mit Rand um den Zielrahmen (margin = Anteil der Rahmenhöhe je Seite),
 * damit die Kartenkanten sicher im Bild sind. Liefert auch, wo der Zielrahmen im Canvas liegt.
 */
export function drawAroundCard(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxHeight: number, margin: number): { ctx: CanvasRenderingContext2D; guide: Rect } | null {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return null;
  const guideInVideo = boxToVideo(guideRect(clientWidth, clientHeight), videoWidth, videoHeight, clientWidth, clientHeight);
  const m = guideInVideo.height * margin;
  const x0 = Math.max(0, guideInVideo.x - m);
  const y0 = Math.max(0, guideInVideo.y - m);
  const src = { x: x0, y: y0, width: Math.min(videoWidth, guideInVideo.x + guideInVideo.width + m) - x0, height: Math.min(videoHeight, guideInVideo.y + guideInVideo.height + m) - y0 };
  const scale = Math.min(1, maxHeight / src.height);
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, src.x, src.y, src.width, src.height, 0, 0, canvas.width, canvas.height);
  const guide = {
    x: (guideInVideo.x - x0) * scale,
    y: (guideInVideo.y - y0) * scale,
    width: guideInVideo.width * scale,
    height: guideInVideo.height * scale,
  };
  return { ctx, guide };
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

/** Höhe des Bildausschnitts für die Zustandsschätzung (inklusive Rand). */
export const CONDITION_CROP_HEIGHT = 1000;
