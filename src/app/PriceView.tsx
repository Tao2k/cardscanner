import { useId, useState } from 'preact/hooks';
import { compareCollectorNumbers, setRanks } from '../core/excel';
import { averageValue, collectionMovers, collectionSeries, dayOf, valueChart, type ChartPoint, type Mover, type PriceHistoryFile } from '../core/priceHistory';
import { collectionValue, formatAsOf, formatEur } from '../core/prices';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { printingCode } from './format';
import type { Prefs, PriceSort } from './prefs';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  histories: Map<string, PriceHistoryFile>;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
}

const PERIODS: { days: number | null; label: string }[] = [
  { days: 7, label: '7 Tage' },
  { days: 30, label: '30 Tage' },
  { days: 365, label: '1 Jahr' },
  { days: null, label: 'Alles' },
];
const SORTS: { value: PriceSort; label: string }[] = [
  { value: 'value', label: 'Wert, höchster zuerst' },
  { value: 'gain', label: 'Prozent, stärkster Anstieg zuerst' },
  { value: 'loss', label: 'Prozent, stärkster Rückgang zuerst' },
  { value: 'change', label: 'Größte Änderung in €' },
  { value: 'number', label: 'Sammlernummer' },
];

type Filter = 'all' | 'up' | 'down';

const PCT = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const SIGNED_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const day = (d: string) => formatAsOf(`${d}T12:00:00Z`);
const trend = (delta: number) => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
const arrow = (delta: number) => (delta > 0 ? '▲' : delta < 0 ? '▼' : '');
const pointLabel = (p: ChartPoint) => (p.average ? `Ø ${p.average} Tage` : day(p.date));
const sinceLabel = (p: ChartPoint) => (p.average ? `ggü. Ø ${p.average} Tage` : `seit ${day(p.date)}`);
const cardCount = (n: number) => (n === 1 ? '1 Karte' : `${n} Karten`);

interface SetGroup {
  key: string;
  gameId: string;
  code: string;
  name: string;
  movers: Mover[];
}

export function PriceView({ items, catalogs, histories, prefs, setPrefs }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sorting, setSorting] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const days = prefs.pricePeriod;

  const now = collectionValue(items, catalogs.price, catalogs.lookup);
  const asOf = [...new Set(items.map((i) => i.gameId))]
    .map((g) => catalogs.prices.get(g)?.asOf)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const chart = asOf
    ? valueChart(collectionSeries(items, histories, catalogs.lookup), { date: dayOf(asOf), value: now.total }, days, {
        30: averageValue(items, catalogs.price, catalogs.lookup, 30),
        7: averageValue(items, catalogs.price, catalogs.lookup, 7),
      })
    : [];
  const hasChart = chart.length > 1;
  const first = chart[0];
  const shown = hasChart ? chart[scrub ?? chart.length - 1] : undefined;
  const change = shown && first ? Math.round((shown.value - first.value) * 100) / 100 : 0;

  const movers = collectionMovers(items, histories, catalogs.lookup, days, catalogs.price);
  const ups = movers.filter((m) => m.strong && m.delta > 0).length;
  const downs = movers.filter((m) => m.strong && m.delta < 0).length;
  const list = movers.filter((m) => filter === 'all' || (m.strong && (filter === 'up' ? m.delta > 0 : m.delta < 0)));

  const number = (m: Mover) => catalogs.lookup(m.gameId, m.printingId)?.collectorNumber ?? '';
  const byNumber = (a: Mover, b: Mover) => compareCollectorNumbers(number(a), number(b)) || a.finish.localeCompare(b.finish);
  const byValue = (a: Mover, b: Mover) => b.to - a.to || b.quantity - a.quantity || byNumber(a, b);
  const order: Record<PriceSort, (a: Mover, b: Mover) => number> = {
    value: byValue,
    gain: (a, b) => b.pct - a.pct || byValue(a, b),
    loss: (a, b) => a.pct - b.pct || byValue(a, b),
    change: (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || byValue(a, b),
    number: byNumber,
  };

  // Sets wie in der Sammlung und im Export: nach Erscheinen, die Karten darin nach der gewählten Sortierung
  const ranks = new Map([...catalogs.sets].map(([gameId, sets]) => [gameId, setRanks(sets)]));
  const groups = new Map<string, SetGroup>();
  for (const m of list) {
    const code = catalogs.lookup(m.gameId, m.printingId)?.setCode ?? '';
    const key = `${m.gameId}|${code}`;
    let group = groups.get(key);
    if (!group) {
      const name = catalogs.sets.get(m.gameId)?.find((s) => s.code === code)?.name ?? (code || 'Ohne Set');
      groups.set(key, (group = { key, gameId: m.gameId, code, name, movers: [] }));
    }
    group.movers.push(m);
  }
  const rankOf = (g: SetGroup) => ranks.get(g.gameId)?.get(g.code) ?? Number.MAX_SAFE_INTEGER;
  const sets = [...groups.values()].sort((a, b) => a.gameId.localeCompare(b.gameId) || rankOf(a) - rankOf(b) || a.code.localeCompare(b.code));
  for (const g of sets) g.movers.sort(order[prefs.priceSort] ?? byValue);

  const collapsed = new Set(prefs.priceCollapsed);
  const toggleSet = (key: string) => {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setPrefs({ priceCollapsed: [...next] });
  };

  const row = (m: Mover) => {
    const printing = catalogs.lookup(m.gameId, m.printingId);
    const key = `${m.gameId}|${m.printingId}|${m.finish}`;
    const expanded = open === key;
    const url = catalogs.price(m.gameId, m.printingId)?.url;
    return (
      <li key={key} class={m.strong ? `strong-${trend(m.delta)}` : ''}>
        <div class="main">
          {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
          <button class="info" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
            <strong>{printing?.cardName ?? m.printingId}</strong>
            <small>
              {printing ? printingCode(printing) : ''}
              {m.finish === 'foil' ? ' · Foil' : ''}
              {m.quantity > 1 ? ` · ${m.quantity}×` : ''}
            </small>
            <span class="price">
              {formatEur(m.to)}
              <small class="muted"> vorher {formatEur(m.from)}</small>
            </span>
          </button>
          <span class="move-col">
            <span class={`delta ${trend(m.delta)}${m.strong ? ' strong' : ''}`}>
              {m.strong && `${arrow(m.delta)} `}
              {PCT.format(m.pct)}
            </span>
            <small class={trend(m.delta)}>{SIGNED_EUR.format(m.delta)}</small>
          </span>
        </div>
        {expanded && (
          <div class="details">
            {m.series.length > 1 && <Sparkline values={m.series} label={`Preisverlauf ${printing?.cardName ?? ''}`} />}
            <small>
              {SIGNED_EUR.format(m.delta)} je Karte
              {m.quantity > 1 ? ` · ${SIGNED_EUR.format(m.delta * m.quantity)} für ${m.quantity}` : ''} ·{' '}
              {m.basis.kind === 'history' ? `seit ${day(m.basis.since)}` : `ggü. Ø ${m.basis.days} Tage`}
            </small>
            {url && (
              <a href={url} target="_blank" rel="noopener">
                Cardmarket ↗
              </a>
            )}
          </div>
        )}
      </li>
    );
  };

  const setHead = (g: SetGroup) => {
    const from = g.movers.reduce((n, m) => n + m.from * m.quantity, 0);
    const to = g.movers.reduce((n, m) => n + m.to * m.quantity, 0);
    const delta = Math.round((to - from) * 100) / 100;
    const isOpen = !collapsed.has(g.key);
    return (
      <button class="set-head" aria-expanded={isOpen} onClick={() => toggleSet(g.key)}>
        <svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="set-name">
          <strong>{g.name}</strong>
          <small class="muted">
            {cardCount(g.movers.reduce((n, m) => n + m.quantity, 0))} · {formatEur(to)}
          </small>
        </span>
        <span class={`set-change ${trend(delta)}`}>{PCT.format(from > 0 ? delta / from : 0)}</span>
      </button>
    );
  };

  return (
    <section class="prices">
      <header>
        <h1>Preise</h1>
      </header>

      {!items.length ? (
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
          </svg>
          <strong>Noch keine Karten</strong>
        </div>
      ) : (
        <>
          <div class="value-card">
            <span class="muted">{scrub !== null && shown ? pointLabel(shown) : 'Sammlung'}</span>
            <strong class="total">{formatEur(shown?.value ?? now.total)}</strong>
            {hasChart && first && (
              <span class="change-row">
                <span class={`change ${trend(change)}`}>
                  {arrow(change)} {SIGNED_EUR.format(change)} · {PCT.format(first.value > 0 ? change / first.value : 0)}
                </span>
                <small class="muted">{sinceLabel(first)}</small>
              </span>
            )}
            {hasChart && <ValueChart points={chart} active={scrub} onScrub={setScrub} />}
            <div class="segmented" role="radiogroup" aria-label="Zeitraum">
              {PERIODS.map((p) => (
                <button
                  role="radio"
                  aria-checked={days === p.days}
                  class={days === p.days ? 'active' : ''}
                  onClick={() => {
                    setPrefs({ pricePeriod: p.days });
                    setScrub(null);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {now.unpriced > 0 && <small class="muted">{now.unpriced} ohne Preis</small>}
          </div>

          <div class="list-head">
            <h2>Deine Karten</h2>
            <button class="sort" aria-haspopup="dialog" onClick={() => setSorting(true)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              Sortieren
            </button>
          </div>
          <div class="chips filters" role="radiogroup" aria-label="Filter">
            {(
              [
                ['all', `Alle ${movers.length}`],
                ['up', `▲ Gewinner ${ups}`],
                ['down', `▼ Verlierer ${downs}`],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button role="radio" aria-checked={filter === value} class={`${filter === value ? 'active' : ''} ${value}`} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          {sets.length ? (
            <div class="set-list">
              {sets.map((g) => (
                <div class="set-group" key={g.key}>
                  {setHead(g)}
                  {!collapsed.has(g.key) && <ol class="items movers">{g.movers.map(row)}</ol>}
                </div>
              ))}
            </div>
          ) : (
            <p class="muted none">{movers.length ? 'Keine Karte' : 'Noch keine Vergleichspreise'}</p>
          )}
        </>
      )}

      {sorting && (
        <>
          <div class="backdrop" onClick={() => setSorting(false)} />
          <div class="sheet" role="dialog" aria-label="Sortieren">
            <div class="grabber" />
            <h2>Sortieren</h2>
            <div class="options" role="radiogroup" aria-label="Sortieren nach">
              {SORTS.map((o) => (
                <button
                  role="radio"
                  aria-checked={prefs.priceSort === o.value}
                  class={prefs.priceSort === o.value ? 'active' : ''}
                  onClick={() => {
                    setPrefs({ priceSort: o.value });
                    setSorting(false);
                  }}
                >
                  {o.label}
                  {prefs.priceSort === o.value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const dayIndex = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * Wertverlauf wie ein Kurschart: grün bei Gewinn, rot bei Verlust, gestrichelt, solange er auf Durchschnittspreisen
 * beruht. Antippen und Ziehen (bzw. Maus darüber) zeigt den Wert an diesem Tag.
 */
function ValueChart({ points, active, onScrub }: { points: ChartPoint[]; active: number | null; onScrub(i: number | null): void }) {
  const id = useId();
  const w = 320;
  const h = 170;
  const x0 = dayIndex(points[0].date);
  const xSpan = dayIndex(points[points.length - 1].date) - x0 || 1;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ySpan = max - min || Math.max(1, max * 0.1);
  const x = (i: number) => ((dayIndex(points[i].date) - x0) / xSpan) * w;
  const y = (v: number) => 10 + (1 - (v - min) / ySpan) * (h - 20);
  const path = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((p, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join('');
  const last = points.length - 1;
  const firstReal = Math.max(0, points.findIndex((p) => !p.average));
  const direction = trend(values[last] - values[0]);

  const pick = (e: PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const target = x0 + ((e.clientX - rect.left) / rect.width) * xSpan;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(dayIndex(p.date) - target) < Math.abs(dayIndex(points[best].date) - target)) best = i;
    });
    onScrub(best);
  };

  return (
    <figure class={`value-chart ${direction}`}>
      <div
        class="plot"
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons ? pick(e) : undefined)}
        onPointerUp={(e) => e.pointerType !== 'mouse' && onScrub(null)}
        onPointerCancel={() => onScrub(null)}
        onPointerLeave={() => onScrub(null)}
      >
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Wert der Sammlung">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="currentColor" stop-opacity="0.24" />
              <stop offset="1" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path(0, last)}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
          <line class="base" x1="0" x2={w} y1={y(values[0])} y2={y(values[0])} vector-effect="non-scaling-stroke" />
          {firstReal > 0 && <path d={path(0, firstReal)} class="line estimate" vector-effect="non-scaling-stroke" />}
          {firstReal < last && <path d={path(firstReal, last)} class="line" vector-effect="non-scaling-stroke" />}
        </svg>
        {active !== null && points[active] && (
          <>
            <span class="cursor" style={{ left: `${(x(active) / w) * 100}%` }} />
            <span class="dot" style={{ left: `${(x(active) / w) * 100}%`, top: `${(y(points[active].value) / h) * 100}%` }} />
          </>
        )}
      </div>
      <figcaption>
        <span>{pointLabel(points[0])}</span>
        <span>
          {formatEur(min)} – {formatEur(max)}
        </span>
        <span>{day(points[last].date)}</span>
      </figcaption>
    </figure>
  );
}

/** Kleiner Verlauf einer einzelnen Karte. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const w = 320;
  const h = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, max * 0.1);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => 6 + (1 - (v - min) / span) * (h - 12);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <figure class={`chart small ${trend(values[values.length - 1] - values[0])}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.24" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
        <path d={line} class="line" vector-effect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}
