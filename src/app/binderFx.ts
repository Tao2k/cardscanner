/**
 * Neue Karten fliegen in den Binder: aus dem Reiter „Sammlung“ unten in einem Bogen in ihren Platz.
 * Läuft wie captureFx direkt im DOM (fixe Positionen über allem), damit Preact nicht mitrendern muss.
 */

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export interface Flight {
  /** Gelandet (oder abgebrochen). */
  done: Promise<void>;
  cancel(): void;
}

/**
 * @param src      Kartenbild
 * @param target   Platz im Binder
 * @param duration Flugzeit in ms
 */
export function flyInto(src: string, target: Element, duration: number): Flight {
  const to = target.getBoundingClientRect();
  const origin = document.querySelector('[data-tab="collection"]')?.getBoundingClientRect();
  const fromX = origin ? origin.left + origin.width / 2 : window.innerWidth / 2;
  const fromY = origin ? origin.top : window.innerHeight;

  const card = document.createElement('img');
  card.className = 'fx-binder-card';
  card.src = src;
  card.alt = '';
  Object.assign(card.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.body.append(card);

  // Verschiebungen der Kartenmitte relativ zum Ziel; der Bogen steigt über den Platz, dort ist die Karte am größten
  const cx = to.left + to.width / 2;
  const cy = to.top + to.height / 2;
  const startX = fromX - cx;
  const startY = fromY - cy;
  const midX = startX * 0.3;
  const midY = -Math.min(120, cy * 0.4);
  const animation = card.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) scale(0.2) rotate(-16deg)`, opacity: 0, boxShadow: '0 4px 10px rgba(0,0,0,.2)' },
      { opacity: 1, offset: 0.1 },
      { transform: `translate(${midX}px, ${midY}px) scale(1.3) rotate(6deg)`, boxShadow: '0 22px 40px rgba(22,19,26,.35)', offset: 0.55 },
      { transform: 'translate(0, -4px) scale(1.04) rotate(-1.5deg)', boxShadow: '0 8px 16px rgba(22,19,26,.25)', offset: 0.88 },
      { transform: 'none', opacity: 1, boxShadow: '0 1px 2px rgba(22,19,26,.15)' },
    ],
    { duration, easing: 'cubic-bezier(.32,.72,.28,1)', fill: 'forwards' },
  );

  let cancelled = false;
  const done = animation.finished.then(
    () => undefined,
    () => undefined,
  );
  done.then(() => card.remove());
  return {
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      animation.cancel();
      card.remove();
    },
  };
}

/** Platz bestätigt das Einstecken: kurz nachgeben und zurückfedern. */
export function settle(target: Element) {
  target.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.94)', offset: 0.35 }, { transform: 'scale(1.04)', offset: 0.7 }, { transform: 'scale(1)' }], {
    duration: 380,
    easing: 'ease-out',
  });
}
