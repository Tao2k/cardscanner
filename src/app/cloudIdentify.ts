import { cloud, cloudConfigured } from './cloud';
import type { Printing } from '../core/types';

/**
 * Cloud-Hilfe für unsichere Scans: Statt sofort nachzufragen, schickt die App das Kamerabild und die
 * Kandidaten an die Supabase-Funktion identify-card, die Claude Name, Nummer und Motiv vergleichen lässt.
 * Ohne Anmeldung, ohne eingerichtete Funktion oder ohne Netz fragt die App wie bisher nach.
 */
export interface CloudAnswer {
  /** Gewählter Kandidat, null wenn keiner passt. */
  printingId: string | null;
  /** Was Claude auf der Karte gelesen hat. */
  name: string | null;
  number: string | null;
  /** Karte und Variante eindeutig: ohne Nachfrage speichern. */
  sure: boolean;
}

/** Länger warten lohnt nicht: Dann ist Nachfragen schneller. */
const TIMEOUT_MS = 12000;
/** Kamerabild für Claude: groß genug, um Name und Sammlernummer zu lesen. */
const PHOTO_HEIGHT = 900;

/** Fehlt die Funktion (oder ihr Schlüssel), nicht bei jedem Scan erneut warten. */
let unavailable = false;

export function cloudHelpAvailable(): boolean {
  return cloudConfigured && cloud.state.signedIn && !unavailable;
}

function photoOf(card: HTMLCanvasElement): { data: string; type: 'image/jpeg' } {
  const scale = Math.min(1, PHOTO_HEIGHT / card.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(card.width * scale);
  canvas.height = Math.round(card.height * scale);
  canvas.getContext('2d')!.drawImage(card, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], type: 'image/jpeg' };
}

async function imageOf(url: string | undefined): Promise<{ data: string; type: 'image/webp' } | undefined> {
  if (!url) return undefined;
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { data: dataUrl.split(',')[1], type: 'image/webp' };
  } catch {
    return undefined;
  }
}

/** Fragt Claude; null, wenn die Hilfe nicht verfügbar ist oder nicht rechtzeitig antwortet. */
export async function askCloud(game: string, card: HTMLCanvasElement, candidates: Printing[], refOf: (p: Printing) => string | undefined): Promise<CloudAnswer | null> {
  if (!cloudHelpAvailable()) return null;
  try {
    const body = {
      game,
      photo: photoOf(card),
      candidates: await Promise.all(
        candidates.map(async (p) => ({ id: p.printingId, name: p.cardName, set: p.setCode, number: p.collectorNumber, variant: p.variant, image: await imageOf(refOf(p)) })),
      ),
    };
    const client = await cloud.getClient();
    const call = client.functions.invoke<CloudAnswer & { error?: string }>('identify-card', { body });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const result = await Promise.race([call, timeout]);
    if (!result) return null;
    if (result.error) {
      // 404: Funktion nicht verteilt, 503: Schlüssel oder Tabelle fehlt. Bis zum Neuladen nicht mehr versuchen.
      const status = (result.error as { context?: Response }).context?.status;
      if (status === 404 || status === 503) unavailable = true;
      return null;
    }
    const answer = result.data;
    if (!answer || answer.error) return null;
    return { printingId: answer.printingId ?? null, name: answer.name ?? null, number: answer.number ?? null, sure: !!answer.sure };
  } catch {
    return null;
  }
}
