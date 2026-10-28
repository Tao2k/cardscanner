import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { UpdateScheduler } from '../core/update';

/** Regelmäßig nachsehen, solange die App offen ist. */
const CHECK_EVERY_MS = 30 * 60_000;

let registration: ServiceWorkerRegistration | undefined;

export const updates = new UpdateScheduler({
  async check() {
    if (!registration || !navigator.onLine) return false;
    await registration.update();
    return !!(registration.installing || registration.waiting);
  },
  reload: () => window.location.reload(),
  now: () => Date.now(),
});

/** Version dieses Builds, z. B. „1.4 · a1b2c3d · 24.10.2026“. */
export const APP_VERSION = [__APP_VERSION__, __APP_COMMIT__, new Date(__APP_BUILT__).toLocaleDateString('de-DE')].filter(Boolean).join(' · ');

/** Service Worker anmelden und auf neue Versionen achten. */
export function startUpdates() {
  registerSW({
    immediate: true,
    // Statt sofort neu zu laden (auch mitten im Scan) entscheidet der Planer, wann es passt.
    onNeedReload: () => updates.activated(),
    onRegisteredSW: (_url, r) => {
      registration = r;
      void updates.maybeCheck();
    },
  });
  document.addEventListener('visibilitychange', () => updates.setVisible(document.visibilityState === 'visible'));
  // iOS meldet das Zurückkehren aus dem App-Umschalter teils nur als pageshow
  window.addEventListener('pageshow', () => updates.setVisible(document.visibilityState === 'visible'));
  window.addEventListener('online', () => void updates.maybeCheck());
  setInterval(() => void updates.maybeCheck(), CHECK_EVERY_MS);
  // Nach einem Update fehlen Teile der alten Version auf dem Server: dann die neue laden.
  window.addEventListener('vite:preloadError', () => window.location.reload());
}

/** Ist eine neue Version aktiv, die erst nach dem Neuladen zu sehen ist? */
export function useUpdatePending() {
  const [pending, setPending] = useState(updates.pending);
  useEffect(() => {
    updates.onPendingChange = setPending;
    return () => (updates.onPendingChange = undefined);
  }, []);
  return pending;
}
