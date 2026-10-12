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

/** Schneidet den Bereich des Zielrahmens aus dem aktuellen Kamerabild aus. */
export function grabCard(video: HTMLVideoElement, canvas: HTMLCanvasElement): Pixels | null {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video;
  if (!videoWidth || !videoHeight || !clientWidth || !clientHeight) return null;
  const src = boxToVideo(guideRect(clientWidth, clientHeight), videoWidth, videoHeight, clientWidth, clientHeight);
  const height = CROP_HEIGHT;
  const width = Math.round((src.width / src.height) * height);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, src.x, src.y, src.width, src.height, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height, channels: 4 };
}
