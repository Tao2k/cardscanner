import { useEffect, useRef } from 'preact/hooks';

/**
 * Zurück-Taste (Android) und Zurück-Wischen: Jede Ebene, die sich schließen lässt (Blatt, Profil,
 * Deckbau, offener Binder, anderer Tab als „Scannen“), legt einen Eintrag in den Browserverlauf.
 * „Zurück“ schließt dann die oberste Ebene, statt die App zu verlassen. Erst auf „Scannen“ ohne
 * offene Ebene beendet „Zurück“ die App, wie bei Android-Apps üblich.
 *
 * Schließt man eine Ebene selbst (Knopf, daneben tippen), nimmt history.back() ihren Eintrag wieder
 * heraus. Das läuft verzögert; neue Einträge warten so lange, damit der Verlauf nicht durcheinandergerät.
 */
interface Layer {
  /** false: die Ebene bleibt offen (z. B. Blatt mit Pflichtfrage), der Eintrag kommt wieder hinein. */
  close(): boolean | void;
  active: boolean;
}

const stack: Layer[] = [];
/** Eigene history.back()-Aufrufe, deren popstate noch aussteht. */
let pendingBacks = 0;
/** Einträge, die auf ein ausstehendes history.back() warten. */
let queuedPushes = 0;
let listening = false;

const push = () => history.pushState({ scannrLayer: true }, '');

function onPop() {
  if (pendingBacks > 0) {
    pendingBacks--;
    if (pendingBacks === 0) for (; queuedPushes > 0; queuedPushes--) push();
    return;
  }
  const layer = stack.pop();
  if (!layer) return;
  if (layer.close() === false) {
    stack.push(layer);
    push();
    return;
  }
  layer.active = false;
}

/** Ebene anmelden; die Rückgabe meldet sie wieder ab, wenn sie anders als per „Zurück“ geschlossen wurde. */
export function openLayer(close: () => boolean | void): () => void {
  if (!listening) {
    addEventListener('popstate', onPop);
    listening = true;
  }
  const layer: Layer = { close, active: true };
  stack.push(layer);
  if (pendingBacks > 0) queuedPushes++;
  else push();
  return () => {
    if (!layer.active) return;
    layer.active = false;
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (queuedPushes > 0) {
      queuedPushes--;
      return;
    }
    pendingBacks++;
    history.back();
  };
}

/**
 * Solange `active`, schließt „Zurück“ diese Ebene mit `onBack`. Gibt onBack false zurück, bleibt sie offen.
 * Die Reihenfolge der Ebenen ist die Reihenfolge, in der sie aktiv werden.
 */
export function useBack(active: boolean, onBack: () => boolean | void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!active) return;
    return openLayer(() => handler.current());
  }, [active]);
}
