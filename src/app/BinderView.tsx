import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatEur, priceFor } from '../core/prices';
import type { Catalogs } from './App';
import { pages, PER_PAGE, withoutFirst, type Binder, type Slot } from './binder';
import { flyInto, reducedMotion, settle, type Flight } from './binderFx';
import { CoverMotif } from './BinderMotif';
import { themeOf, themeStyle, uiColor } from './binderThemes';
import { printingCode } from './format';

interface Props {
  binders: Binder[];
  catalogs: Catalogs;
  /** Gewählter Binder („gameId|setCode“). */
  selected: Binder;
  onSelect(key: string): void;
  /** Neu gescannte Exemplare („gameId|printingId“), die beim Öffnen in ihre Plätze fliegen. */
  arriving: string[];
}

/** Wie lange ein frisch eingesteckter Platz grün leuchtet. */
const FRESH_MS = 2400;
/** Mehr Karten fliegen nicht einzeln, der Rest steckt danach auf einmal. */
const MAX_FLIGHTS = 40;
/** Dauer des Auf- und Zuklappens. */
const COVER_MS = 820;
/** Deckel klappt um den Rücken links nach vorn auf, steht kurz senkrecht und verschwindet. */
const COVER_OPENING: Keyframe[] = [
  { transform: 'perspective(1600px) rotateY(0deg)', opacity: 1 },
  { transform: 'perspective(1600px) rotateY(-10deg)', opacity: 1, offset: 0.12 },
  { transform: 'perspective(1600px) rotateY(-80deg)', opacity: 1, offset: 0.75 },
  { transform: 'perspective(1600px) rotateY(-96deg)', opacity: 0 },
];
const COVER_EASING = 'cubic-bezier(.33,0,.2,1)';
/** Dauer des Umblätterns über die Pfeile. */
const TURN_MS = 480;
/** Ab diesem Anteil der Seitenbreite blättert ein Wischen um, sonst fällt die Seite zurück. */
const TURN_AT = 0.35;
/** So schnell gewischt (px/ms) blättert es auch bei kurzem Weg um. */
const FLICK = 0.45;

/** Laufendes Umblättern: die obere Seite dreht sich um den linken Rand, darunter liegt die andere. */
interface Turn {
  from: number;
  to: number;
  /** Weg der freien Kante: 0 = Ausgangsseite liegt, 1 = umgeblättert */
  p: number;
  frame?: number;
  finished: Promise<void>;
  resolve(): void;
}

/** Wischen über die Seite, bis klar ist, ob waagrecht geblättert wird. */
interface Swipe {
  id: number;
  x: number;
  y: number;
  from: number;
  /** Zielseite, sobald waagrecht gewischt wird */
  to?: number;
  turn?: Turn;
  lastX: number;
  lastT: number;
  /** px/ms, negativ nach links */
  speed: number;
}

/** Binder zu, beim Aufklappen, offen oder beim Zuklappen. */
type CoverState = 'closed' | 'opening' | 'open' | 'closing';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const imageOf = (s: Slot) => s.printing.thumbUrl ?? s.printing.imageUrl;

export function BinderView({ binders, catalogs, selected, onSelect, arriving }: Props) {
  const slotIndex = useMemo(() => {
    const index = new Map<string, { binder: Binder; at: number }>();
    binders.forEach((binder) => binder.slots.forEach((s, at) => index.set(s.key, { binder, at })));
    return index;
  }, [binders]);
  // Reihenfolge des Einfliegens: Binder für Binder, Platz für Platz, damit nur vorwärts geblättert wird
  const [queue] = useState(() => {
    const order = (k: string) => {
      const hit = slotIndex.get(k);
      return hit ? binders.indexOf(hit.binder) * 1e6 + hit.at : Infinity;
    };
    return arriving.filter((k) => slotIndex.has(k)).sort((a, b) => order(a) - order(b));
  });
  /** Noch nicht gelandete Exemplare; ihre Plätze zeigen sie bis dahin nicht. */
  const [pending, setPending] = useState<string[]>(queue);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [page, setPageState] = useState(0);
  /** Aktuelle Seite, auch nach await. */
  const pageNow = useRef(0);
  const setPage = (index: number) => {
    pageNow.current = index;
    setPageState(index);
  };
  /** Beim Umblättern: Seite, die sich dreht, und Seite darunter. */
  const [turning, setTurning] = useState<{ top: number; under: number } | null>(null);
  const turn = useRef<Turn | null>(null);
  const swipe = useRef<Swipe | null>(null);
  /** Nach einem Wischen keinen Platz öffnen. */
  const swiped = useRef(false);
  const [open, setOpen] = useState<Slot | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected.key);
  selectedRef.current = selected.key;
  /** Überspringen, solange Karten fliegen. */
  const [skip, setSkip] = useState<(() => void) | null>(null);
  // Der Binder ist zu, bis man ihn antippt; neue Karten klappen ihn selbst auf (bei reduzierter Bewegung ist er dann gleich offen)
  const [cover, setCoverState] = useState<CoverState>(() => (queue.length && reducedMotion() ? 'open' : 'closed'));
  const coverNow = useRef(cover);
  const setCover = (state: CoverState) => {
    coverNow.current = state;
    setCoverState(state);
  };
  /** Aktueller Stand, auch nach await (der State der Darstellung hinkt hinterher). */
  const coverIs = (state: CoverState) => coverNow.current === state;
  const coverRef = useRef<HTMLButtonElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);

  const shown = (s: Slot) => s.quantity - pending.filter((k) => k === s.key).length;
  const owned = selected.slots.filter((s) => shown(s) > 0).length;
  const sheets = pages(selected.slots);

  const markFresh = (keys: string[]) => {
    setFresh((f) => new Set([...f, ...keys]));
    setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !keys.includes(k)))), FRESH_MS);
  };

  const pageEl = (index: number) => pagesRef.current?.children[index] as HTMLElement | undefined;
  const shadeOf = (el: HTMLElement) => el.lastElementChild as HTMLElement;

  /** Seiten in Stellung bringen: p ist der Weg der freien Kante, der Winkel folgt daraus (die Kante bleibt unter dem Finger). */
  const pose = (t: Turn, p: number) => {
    t.p = p;
    const forward = t.to > t.from;
    const top = pageEl(forward ? t.from : t.to);
    const under = pageEl(forward ? t.to : t.from);
    // 0 = obere Seite liegt flach, 1 = steht senkrecht am Rand
    const lifted = clamp01(forward ? p : 1 - p);
    if (top) {
      top.style.transform = `perspective(3200px) rotateY(${(-(Math.acos(1 - lifted) * 180) / Math.PI).toFixed(2)}deg)`;
      shadeOf(top).style.opacity = (lifted * 0.28).toFixed(3);
    }
    // Schatten der Seite darüber, wird heller, je weiter sie sich hebt
    if (under) shadeOf(under).style.opacity = ((1 - lifted) * 0.22).toFixed(3);
  };

  const begin = (from: number, to: number) => {
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    const t: Turn = { from, to, p: 0, finished, resolve: () => resolve() };
    turn.current = t;
    setTurning(to > from ? { top: from, under: to } : { top: to, under: from });
    pose(t, 0);
    return t;
  };

  /** Kante gleitet von ihrer Stelle nach `target`. */
  const glide = (t: Turn, target: number, ms: number, ease: (x: number) => number) =>
    new Promise<void>((done) => {
      const start = performance.now();
      const from = t.p;
      const step = () => {
        if (turn.current !== t) return done();
        const x = clamp01((performance.now() - start) / ms);
        pose(t, from + (target - from) * ease(x));
        if (x < 1) t.frame = requestAnimationFrame(step);
        else done();
      };
      t.frame = requestAnimationFrame(step);
    });

  /** Umgeblättert oder zurückgefallen: Seiten wieder flach hinlegen. */
  const end = async (t: Turn, turned: boolean) => {
    if (turn.current !== t) return;
    turn.current = null;
    if (turned) setPage(t.to);
    setTurning(null);
    await frame();
    for (const index of [t.from, t.to]) {
      const el = pageEl(index);
      if (!el) continue;
      el.style.transform = '';
      shadeOf(el).style.opacity = '';
    }
    t.resolve();
  };

  /** Laufendes Umblättern abbrechen (anderes Set). */
  const stopTurn = () => {
    const t = turn.current;
    swipe.current = null;
    if (!t) return;
    if (t.frame) cancelAnimationFrame(t.frame);
    turn.current = null;
    setTurning(null);
    t.resolve();
  };
  useEffect(() => stopTurn, []);

  /** Auf die Seite blättern; wartet, bis sie liegt. */
  const turnTo = async (index: number, smooth = !reducedMotion()) => {
    await turn.current?.finished;
    const from = pageNow.current;
    if (index === from) return;
    if (!smooth) {
      setPage(index);
      await frame();
      return;
    }
    const t = begin(from, index);
    await frame();
    await glide(t, 1, TURN_MS, easeInOut);
    await end(t, true);
  };

  const widthOf = (index: number) => pageEl(index)?.offsetWidth || 1;
  const progress = (s: Swipe, x: number) => clamp01(((x - s.x) * (s.to! > s.from ? -1 : 1)) / widthOf(s.from));

  const onPointerDown = (e: PointerEvent) => {
    swiped.current = false;
    if (!isOpen || skip || turn.current || sheets.length < 2 || !e.isPrimary || e.button > 0) return;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: pageNow.current, lastX: e.clientX, lastT: e.timeStamp, speed: 0 };
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (s.to === undefined) {
      // Senkrecht gewischt: die Seite scrollt, es wird nicht geblättert
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < 10) return;
      const to = s.from + (dx < 0 ? 1 : -1);
      if (to < 0 || to > lastPage) {
        swipe.current = null;
        return;
      }
      s.to = to;
      swiped.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (!reducedMotion()) s.turn = begin(s.from, to);
    }
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) s.speed = 0.6 * ((e.clientX - s.lastX) / dt) + 0.4 * s.speed;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;
    if (s.turn) pose(s.turn, progress(s, e.clientX));
  };

  /** Loslassen: weit oder schnell genug gewischt blättert um, sonst fällt die Seite zurück. */
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    swipe.current = null;
    if (s.to === undefined) return;
    // Der Klick nach dem Loslassen öffnet keinen Platz, spätere Klicks schon
    setTimeout(() => (swiped.current = false), 300);
    const forward = s.to > s.from;
    // Erst gewischt, dann angehalten: zählt nicht als schneller Wisch
    const speed = e.timeStamp - s.lastT > 80 ? 0 : s.speed;
    const flick = forward ? speed < -FLICK : speed > FLICK;
    const turned = e.type === 'pointerup' && (progress(s, e.clientX) > TURN_AT || flick);
    const t = s.turn;
    if (!t) {
      if (turned) setPage(s.to);
      return;
    }
    const target = turned ? 1 : 0;
    glide(t, target, 120 + 300 * Math.abs(target - t.p), easeOut).then(() => end(t, turned));
  };

  /** Deckel aufklappen; wartet, bis Seite 1 frei liegt. */
  const openCover = async () => {
    if (!coverIs('closed')) return;
    setCover('opening');
    const lid = coverRef.current;
    if (lid && !reducedMotion()) {
      shadeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: COVER_MS, easing: 'ease-in', fill: 'forwards' });
      await lid.animate(COVER_OPENING, { duration: COVER_MS, easing: COVER_EASING, fill: 'forwards' }).finished.catch(() => undefined);
    }
    if (coverIs('opening')) setCover('open');
  };

  /** Zurück auf Seite 1 und den Deckel zuklappen. */
  const closeCover = async () => {
    if (!coverIs('open')) return;
    await turnTo(0);
    setCover('closing');
    await frame();
    await frame();
    const lid = coverRef.current;
    if (lid && !reducedMotion()) {
      const timing = { duration: COVER_MS, easing: COVER_EASING, direction: 'reverse', fill: 'both' } as const;
      shadeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'ease-out' });
      await lid.animate(COVER_OPENING, timing).finished.catch(() => undefined);
    }
    if (coverIs('closing')) setCover('closed');
  };

  /** Den Binder samt Kopf ins Bild holen (unten nicht vom Rand abgeschnitten), bevor Karten hineinfliegen. */
  const reveal = async () => {
    const binder = pagesRef.current;
    const view = binder?.parentElement;
    const main = binder?.closest('main');
    if (!binder || !view || !main) return;
    const b = binder.getBoundingClientRect();
    const top = view.getBoundingClientRect().top;
    const m = main.getBoundingClientRect();
    const delta = b.bottom > m.bottom ? Math.min(b.bottom - m.bottom + 8, top - m.top) : top < m.top ? top - m.top : 0;
    if (Math.abs(delta) < 4) return;
    main.scrollBy({ top: delta, behavior: 'smooth' });
    await sleep(380);
  };

  useEffect(() => {
    if (!queue.length) return;
    const first = slotIndex.get(queue[0])!;
    if (reducedMotion()) {
      if (first.binder.key !== selectedRef.current) onSelect(first.binder.key);
      setPending([]);
      markFresh(queue);
      sleep(60).then(() => turnTo(Math.floor(first.at / PER_PAGE), false));
      return;
    }
    let stopped = false;
    const inAir = new Set<Flight>();
    const land = (key: string) => {
      setPending((p) => withoutFirst(p, key));
      markFresh([key]);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const f of inAir) f.cancel();
      setPending([]);
      markFresh(queue);
      setSkip(null);
      setCover('open');
    };
    setSkip(() => stop);

    (async () => {
      await sleep(320);
      await reveal();
      await openCover();
      const n = Math.min(queue.length, MAX_FLIGHTS);
      const duration = Math.round(Math.max(560, 900 - n * 18));
      const gap = Math.round(Math.max(240, 620 - n * 25));
      let landed: Promise<void>[] = [];
      for (const key of queue.slice(0, MAX_FLIGHTS)) {
        if (stopped) return;
        const { binder, at } = slotIndex.get(key)!;
        const target = Math.floor(at / PER_PAGE);
        if (binder.key !== selectedRef.current || target !== pageNow.current) {
          // Erst alle Karten dieser Seite einstecken, dann umblättern
          await Promise.all(landed);
          landed = [];
          if (stopped) return;
          if (binder.key !== selectedRef.current) {
            // Nächstes Set: dessen Binder liegt zu da und klappt auf
            onSelect(binder.key);
            setPage(0);
            setCover('closed');
            await frame();
            await frame();
            await reveal();
            await openCover();
            if (stopped) return;
          }
          await turnTo(target);
          await reveal();
        }
        const el = pagesRef.current?.querySelector(`[data-slot="${CSS.escape(key)}"]`);
        if (!el || stopped) {
          land(key);
          continue;
        }
        const flight = flyInto(imageOf(binder.slots[at]), el, duration);
        inAir.add(flight);
        landed.push(
          flight.done.then(() => {
            inAir.delete(flight);
            if (stopped) return;
            land(key);
            settle(el);
          }),
        );
        await sleep(gap);
      }
      await Promise.all(landed);
      if (stopped) return;
      // Was nicht einzeln geflogen ist, steckt jetzt auf einmal
      const rest = queue.slice(MAX_FLIGHTS);
      if (rest.length) {
        setPending([]);
        markFresh(rest);
      }
      stopped = true;
      setSkip(null);
    })();

    return () => {
      stopped = true;
      for (const f of inAir) f.cancel();
    };
  }, []);

  const select = (key: string) => {
    skip?.();
    stopTurn();
    setPage(0);
    setCover('closed');
    onSelect(key);
  };

  const pct = selected.slots.length ? Math.round((owned / selected.slots.length) * 100) : 0;
  const lastPage = Math.max(0, sheets.length - 1);
  const shownPage = Math.min(page, lastPage);
  // Aufgeschlagene Seite (beim Umblättern die beiden beteiligten); die Nachbarn liegen unsichtbar bereit und laden ihre Bilder
  const pageClass = (index: number) =>
    turning
      ? index === turning.top
        ? 'top'
        : index === turning.under
          ? 'under'
          : ''
      : index === shownPage
        ? 'current'
        : Math.abs(index - shownPage) === 1
          ? 'near'
          : '';
  const openEntry = open ? catalogs.price(selected.gameId, open.printing.printingId) : undefined;
  const openPrice = open ? priceFor(openEntry, open.foil ? 'foil' : 'normal', open.printing) : undefined;
  // Auf dem Deckel: die wertvollste eigene Karte des Sets
  const valueOf = (s: Slot) => priceFor(catalogs.price(selected.gameId, s.printing.printingId), s.foil ? 'foil' : 'normal', s.printing) ?? 0;
  const showcase = selected.slots.filter((s) => s.quantity > 0).reduce<Slot | null>((best, s) => (!best || valueOf(s) > valueOf(best) ? s : best), null);
  const isOpen = cover === 'open';
  // Farben und Motiv wie das Display des Sets
  const theme = themeOf(selected.key);

  return (
    <div class="binder-view" style={themeStyle(theme)} data-motif={theme.motif}>
      {binders.length > 1 && (
        <div class="chips filters binder-sets" role="tablist" aria-label="Sets">
          {binders.map((b) => (
            <button role="tab" aria-selected={b.key === selected.key} class={b.key === selected.key ? 'active' : ''} onClick={() => select(b.key)}>
              <i class="set-dot" style={{ '--dot': themeOf(b.key).base, '--dot-ring': uiColor(themeOf(b.key)) }} aria-hidden="true" />
              {b.name}
            </button>
          ))}
        </div>
      )}
      <div class="binder-head">
        <div>
          <strong>{selected.name}</strong>
          <small class="muted">
            {owned} von {selected.slots.length}
          </small>
        </div>
        <span class="binder-pct">{pct} %</span>
        {isOpen && !skip && (
          <button class="binder-close" onClick={closeCover}>
            Zuklappen
          </button>
        )}
      </div>
      <div class="binder-progress" role="progressbar" aria-valuemin={0} aria-valuemax={selected.slots.length} aria-valuenow={owned} aria-label="Gesammelt">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div class="binder-stage" key={selected.key}>
      <div
        class="binder"
        ref={pagesRef}
        role="region"
        aria-label={`Binder ${selected.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (!swiped.current) return;
          swiped.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {sheets.map((sheet, i) => (
          <div class={`binder-page ${pageClass(i)}`.trim()} aria-label={`Seite ${i + 1}`}>
            <ol class="pockets">
              {sheet.map((s) => {
                const quantity = shown(s);
                const has = quantity > 0;
                return (
                  <li key={s.key} data-slot={s.key} class={['pocket', has ? 'filled' : 'empty', has && s.foil ? 'foil' : '', fresh.has(s.key) && has ? 'fresh' : ''].join(' ').trim()}>
                    <button onClick={() => setOpen(s)} aria-label={`${s.printing.cardName}, ${s.printing.collectorNumber}${has ? '' : ', fehlt'}`}>
                      <img src={imageOf(s)} alt="" loading="lazy" draggable={false} />
                      {!has && <span class="num">{s.printing.collectorNumber}</span>}
                      {quantity > 1 && <span class="pocket-qty">{quantity}×</span>}
                    </button>
                  </li>
                );
              })}
              {/* Leere Hüllen füllen die letzte Seite auf, damit alle Seiten gleich groß sind */}
              {Array.from({ length: PER_PAGE - sheet.length }, (_, k) => (
                <li key={`blank-${k}`} class="pocket blank" aria-hidden="true" />
              ))}
            </ol>
            <span class="page-shade" aria-hidden="true" />
          </div>
        ))}
      </div>
      {!isOpen && (
        <>
          <div class="binder-shade" ref={shadeRef} aria-hidden="true" />
          <button
            class={`binder-cover ${cover}`}
            ref={coverRef}
            onClick={openCover}
            aria-label={`${selected.name} öffnen`}
          >
            {theme.motif && <CoverMotif motif={theme.motif} />}
            <span class="cover-spine" aria-hidden="true" />
            <span class="cover-face">
              {selected.code && <small>{selected.code}</small>}
              <strong>{selected.name}</strong>
              {showcase && <img src={imageOf(showcase)} alt="" draggable={false} />}
              <span class="cover-open">Öffnen</span>
            </span>
            <span class="cover-strap" aria-hidden="true" />
          </button>
        </>
      )}
      </div>
      {sheets.length > 1 && (
        // Bei geschlossenem Binder nur unsichtbar, damit beim Auf- und Zuklappen nichts springt
        <div class={`binder-nav${isOpen ? '' : ' hidden'}`} aria-hidden={!isOpen}>
          <button class="icon" aria-label="Vorherige Seite" disabled={shownPage <= 0} onClick={() => turnTo(Math.max(0, pageNow.current - 1))}>
            {chevron('M15 6l-6 6 6 6')}
          </button>
          <span>
            Seite {shownPage + 1} von {sheets.length}
          </span>
          <button class="icon" aria-label="Nächste Seite" disabled={shownPage >= lastPage} onClick={() => turnTo(Math.min(lastPage, pageNow.current + 1))}>
            {chevron('M9 6l6 6-6 6')}
          </button>
        </div>
      )}
      {skip && (
        <button class="binder-skip" onClick={skip}>
          Überspringen
        </button>
      )}
      {open && (
        <>
          <div class="backdrop" onClick={() => setOpen(null)} />
          <div class="sheet binder-card" role="dialog" aria-label={open.printing.cardName}>
            <div class="grabber" />
            <img class={shown(open) > 0 ? '' : 'missing'} src={open.printing.imageUrl} alt="" />
            <div class="binder-card-info">
              <h2>{open.printing.cardName}</h2>
              <small class="muted">{printingCode(open.printing)}</small>
              <span class="line">
                {shown(open) > 0 ? <em class="tag">{shown(open)}× in der Sammlung</em> : <em class="tag">Fehlt</em>}
                {open.foil && shown(open) > 0 && <em class="tag foil">Foil</em>}
                {openPrice !== undefined && <span class="price">{formatEur(openPrice)}</span>}
              </span>
              {openEntry?.url && (
                <a href={openEntry.url} target="_blank" rel="noopener">
                  Bei Cardmarket ansehen ↗
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function chevron(d: string) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
