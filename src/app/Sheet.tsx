import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  /** Zusätzliche Klasse am Blatt, z. B. `ask` oder `account-sheet`. */
  class?: string;
  label: string;
  /** Ohne onClose schließt weder ein Tipp daneben noch Wischen oder Escape das Blatt. */
  onClose?: () => void;
  children: ComponentChildren;
}

/** Ab so viel Weg nach unten oder so viel Tempo (px/ms) schließt das Blatt beim Loslassen, sonst federt es zurück. */
const CLOSE_DISTANCE = 0.25;
const CLOSE_SPEED = 0.5;

/**
 * Blatt von unten wie auf dem iPhone: am Griff nach unten wischen, daneben tippen oder Escape schließt es;
 * es fährt dabei wieder hinaus statt zu verschwinden. Der Fokus springt ins Blatt und danach zurück,
 * damit VoiceOver und Tastatur dort weitermachen, wo das Blatt geöffnet wurde.
 */
export function Sheet({ class: cls, label, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; id: number } | null>(null);
  const [closing, setClosing] = useState(false);

  const close = () => {
    if (!onClose || closing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else setClosing(true);
  };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // Kein autoFocus im Blatt: dann das Blatt selbst, sonst öffnete auf dem Handy ungefragt die Tastatur
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true });
    return () => before?.isConnected && before.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose, closing]);

  const move = (dy: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.22s cubic-bezier(.2, .8, .2, 1)' : 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    // Der Hintergrund hellt mit dem Weg auf, wie beim Wegwischen auf dem iPhone
    const shade = backdrop.current;
    if (shade) {
      shade.style.transition = animate ? 'opacity 0.22s ease-out' : 'none';
      shade.style.opacity = dy > 0 ? String(Math.max(0, 1 - dy / el.offsetHeight)) : '';
    }
  };

  const handle = onClose && {
    onPointerDown: (e: PointerEvent) => {
      drag.current = { y: e.clientY, t: e.timeStamp, dy: 0, id: e.pointerId };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      d.dy = Math.max(0, e.clientY - d.y);
      move(d.dy, false);
    },
    onPointerUp: (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const height = ref.current?.offsetHeight ?? 1;
      const speed = d.dy / Math.max(1, e.timeStamp - d.t);
      if (d.dy > height * CLOSE_DISTANCE || (d.dy > 20 && speed > CLOSE_SPEED)) close();
      else move(0, true);
    },
    onPointerCancel: () => {
      drag.current = null;
      move(0, true);
    },
  };

  return (
    <>
      <div ref={backdrop} class={`backdrop${closing ? ' closing' : ''}`} onClick={close} />
      <div
        ref={ref}
        class={`sheet${cls ? ` ${cls}` : ''}${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onAnimationEnd={(e) => e.target === e.currentTarget && closing && onClose?.()}
      >
        <div class={`sheet-handle${handle ? ' draggable' : ''}`} {...handle}>
          <div class="grabber" />
        </div>
        {children}
      </div>
    </>
  );
}
