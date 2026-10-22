/**
 * Rückmeldung beim Erfassen einer Karte, angelehnt an den Bildschirmfoto-Effekt auf dem iPhone:
 * kurzer Blitz, die Karte schrumpft zu einem Vorschaubild in der Ecke und fliegt in „Sammlung“,
 * sobald sie gespeichert ist. Läuft außerhalb von Preact direkt im DOM (fixe Positionen über allem).
 */
export interface CaptureFx {
  /** Gespeichert: Vorschaubild fliegt in den Sammlungs-Reiter. */
  land(): void;
  /** Nicht gespeichert: Vorschaubild verschwindet. */
  cancel(): void;
}

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Kleines Standbild (JPEG) aus dem Kamera-Ausschnitt, für das Vorschaubild. */
export function snapshotOf(canvas: HTMLCanvasElement, height = 280): string | null {
  if (!canvas.width || !canvas.height) return null;
  const small = document.createElement('canvas');
  small.height = height;
  small.width = Math.round((canvas.width / canvas.height) * height);
  small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
  try {
    return small.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  }
}

function collectionTab(): Element | null {
  return document.querySelector('[data-tab="collection"]');
}

/** Den Sammlungs-Reiter kurz anstupsen. */
function bump(target: Element | null) {
  target?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
}

/**
 * @param snapshot Standbild der Karte
 * @param from     wo die Karte auf dem Bildschirm lag (Zielrahmen)
 * @param area     Kamerabereich, in dessen Ecke das Vorschaubild wartet
 * @param flash    Blitz zeigen (beim Erfassen ja, nach einer Nachfrage nicht)
 */
export function captureFx(snapshot: string, from: DOMRect, area: DOMRect, flash = true): CaptureFx {
  if (reducedMotion()) return { land: () => bump(collectionTab()), cancel: () => undefined };

  if (flash) {
    const f = document.createElement('div');
    f.className = 'fx-flash';
    Object.assign(f.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` });
    document.body.append(f);
    f.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' }).finished.finally(() => f.remove());
  }

  const img = document.createElement('img');
  img.className = 'fx-card';
  img.src = snapshot;
  img.alt = '';
  Object.assign(img.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.append(img);

  // Warteposition: unten links im Kamerabereich, gut ein Drittel so groß
  const scale = 0.32;
  const parkX = area.left + 12 - from.left;
  const parkY = area.bottom - 60 - from.height * scale - from.top;
  const parked = `translate(${parkX}px, ${parkY}px) scale(${scale})`;
  img.animate([{ transform: 'none', boxShadow: '0 0 0 0 rgba(0,0,0,0)' }, { transform: 'scale(0.94)', offset: 0.3 }, { transform: parked }], {
    duration: 520,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    fill: 'forwards',
  });

  let done = false;
  const remove = () => {
    done = true;
    img.remove();
  };
  const safety = setTimeout(remove, 30000);

  return {
    land() {
      if (done) return;
      clearTimeout(safety);
      const target = collectionTab();
      if (!target) return remove();
      const t = target.getBoundingClientRect();
      const end = 0.06;
      const dx = t.left + t.width / 2 - (from.width * end) / 2 - from.left;
      const dy = t.top + t.height / 2 - (from.height * end) / 2 - from.top;
      const fly = img.animate([{ transform: parked, opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.4 }], {
        duration: 560,
        easing: 'cubic-bezier(.55,0,.75,.2)',
        fill: 'forwards',
      });
      fly.finished.finally(() => {
        remove();
        bump(target);
      });
    },
    cancel() {
      if (done) return;
      clearTimeout(safety);
      img.animate([{ transform: parked, opacity: 1 }, { transform: parked, opacity: 0 }], { duration: 250, fill: 'forwards' }).finished.finally(remove);
    },
  };
}
