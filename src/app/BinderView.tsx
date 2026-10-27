import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatEur, priceFor } from '../core/prices';
import type { Catalogs } from './App';
import { pages, PER_PAGE, withoutFirst, type Binder, type Slot } from './binder';
import { flyInto, reducedMotion, settle, type Flight } from './binderFx';
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
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
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Slot | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected.key);
  selectedRef.current = selected.key;
  /** Überspringen, solange Karten fliegen. */
  const [skip, setSkip] = useState<(() => void) | null>(null);

  const shown = (s: Slot) => s.quantity - pending.filter((k) => k === s.key).length;
  const owned = selected.slots.filter((s) => shown(s) > 0).length;
  const sheets = pages(selected.slots);

  const markFresh = (keys: string[]) => {
    setFresh((f) => new Set([...f, ...keys]));
    setTimeout(() => setFresh((f) => new Set([...f].filter((k) => !keys.includes(k)))), FRESH_MS);
  };

  const pageWidth = () => {
    const first = pagesRef.current?.firstElementChild;
    return first instanceof HTMLElement ? first.offsetWidth : 0;
  };
  const currentPage = () => (pageWidth() ? Math.round(pagesRef.current!.scrollLeft / pageWidth()) : 0);

  /** Auf die Seite blättern; wartet, bis sie steht. */
  const turnTo = async (index: number, smooth = !reducedMotion()) => {
    const el = pagesRef.current;
    const width = pageWidth();
    if (!el || !width) return;
    setPage(index);
    if (Math.abs(el.scrollLeft - index * width) < 2) return;
    el.scrollTo({ left: index * width, behavior: smooth ? 'smooth' : 'auto' });
    if (smooth) await sleep(Math.min(700, 280 + Math.abs(el.scrollLeft / width - index) * 60));
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
    };
    setSkip(() => stop);

    (async () => {
      await sleep(320);
      await reveal();
      const n = Math.min(queue.length, MAX_FLIGHTS);
      const duration = Math.round(Math.max(560, 900 - n * 18));
      const gap = Math.round(Math.max(240, 620 - n * 25));
      let landed: Promise<void>[] = [];
      for (const key of queue.slice(0, MAX_FLIGHTS)) {
        if (stopped) return;
        const { binder, at } = slotIndex.get(key)!;
        const target = Math.floor(at / PER_PAGE);
        if (binder.key !== selectedRef.current || target !== currentPage()) {
          // Erst alle Karten dieser Seite einstecken, dann umblättern
          await Promise.all(landed);
          landed = [];
          if (stopped) return;
          if (binder.key !== selectedRef.current) {
            onSelect(binder.key);
            await frame();
            await frame();
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
    setPage(0);
    onSelect(key);
  };

  const pct = selected.slots.length ? Math.round((owned / selected.slots.length) * 100) : 0;
  const lastPage = Math.max(0, sheets.length - 1);
  const openEntry = open ? catalogs.price(selected.gameId, open.printing.printingId) : undefined;
  const openPrice = open ? priceFor(openEntry, open.foil ? 'foil' : 'normal', open.printing) : undefined;

  return (
    <div class="binder-view">
      {binders.length > 1 && (
        <div class="chips filters binder-sets" role="tablist" aria-label="Sets">
          {binders.map((b) => (
            <button role="tab" aria-selected={b.key === selected.key} class={b.key === selected.key ? 'active' : ''} onClick={() => select(b.key)}>
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
      </div>
      <div class="binder-progress" role="progressbar" aria-valuemin={0} aria-valuemax={selected.slots.length} aria-valuenow={owned} aria-label="Gesammelt">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div
        class="binder"
        key={selected.key}
        ref={pagesRef}
        role="region"
        aria-label={`Binder ${selected.name}`}
        onScroll={() => setPage(currentPage())}
      >
        {sheets.map((sheet, i) => (
          <div class="binder-page" aria-label={`Seite ${i + 1}`}>
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
          </div>
        ))}
      </div>
      {sheets.length > 1 && (
        <div class="binder-nav">
          <button class="icon" aria-label="Vorherige Seite" disabled={page <= 0} onClick={() => turnTo(Math.max(0, page - 1))}>
            {chevron('M15 6l-6 6 6 6')}
          </button>
          <span>
            Seite {Math.min(page, lastPage) + 1} von {sheets.length}
          </span>
          <button class="icon" aria-label="Nächste Seite" disabled={page >= lastPage} onClick={() => turnTo(Math.min(lastPage, page + 1))}>
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
