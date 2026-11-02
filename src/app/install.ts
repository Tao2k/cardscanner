import { useEffect, useState } from 'preact/hooks';

/**
 * „App installieren“: Chrome auf Android bietet die Installation über das Ereignis beforeinstallprompt an.
 * Es kommt kurz nach dem Laden, deshalb fangen wir es gleich beim Start ab und zeigen den Knopf im Profil.
 * Auf dem iPhone gibt es das nicht; dort steht stattdessen, wie es über „Teilen“ geht.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
/** In dieser Sitzung installiert (der Browser-Tab bleibt offen, ist aber nicht die App). */
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Läuft die App schon als installierte App (eigenes Fenster statt Browser)? */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isAndroid = () => /Android/.test(navigator.userAgent);

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function watchInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    // Kein eigenes Mini-Banner von Chrome; wir bieten es ruhig im Profil an
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

export type InstallState = { kind: 'installed' } | { kind: 'prompt'; install(): Promise<void> } | { kind: 'ios' } | { kind: 'none' };

export function useInstall(): InstallState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (isStandalone() || installedNow) return { kind: 'installed' };
  if (deferred) {
    const event = deferred;
    return {
      kind: 'prompt',
      async install() {
        await event.prompt();
        const { outcome } = await event.userChoice;
        // Das Ereignis gilt nur einmal; abgelehnt bietet Chrome es später neu an
        if (outcome === 'accepted') installedNow = true;
        if (deferred === event) deferred = null;
        notify();
      },
    };
  }
  return isIos() ? { kind: 'ios' } : { kind: 'none' };
}
