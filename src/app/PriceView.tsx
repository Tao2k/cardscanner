import { useId, useState } from 'preact/hooks';
import { compareCollectorNumbers } from '../core/excel';
import { averageValue, collectionMovers, collectionSeries, dayOf, moverOrder, valueChart, type ChartPoint, type Mover, type PriceHistoryFile } from '../core/priceHistory';
import { collectionValue, formatAsOf, formatEur } from '../core/prices';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { printingCode } from './format';
import { PRICE_PERIODS, type Prefs, type PriceSort } from './prefs';
import { arrow, groupBySet, groupChange, MoveCol, PCT, SetSection, SIGNED_EUR, toggled, trend } from './SetList';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  histories: Map<string, PriceHistoryFile>;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  /** Neue Preiswarnungen (Schlüssel moverKey), als „Neu“ markiert. */
  fresh: Set<string>;
}

const SORTS: { value: PriceSort; label: string }[] = [
  { value: 'value-desc', label: 'Preis absteigend' },
  { value: 'value-asc', label: 'Preis aufsteigend' },
  { value: 'change-desc', label: 'Änderung (€) absteigend' },
  { value: 'change-asc', label: 'Änderung (€) aufsteigend' },
  { value: 'pct-desc', label: 'Änderung (%) absteigend' },
  { value: 'pct-asc', label: 'Änderung (%) aufsteigend' },
];

type Filter = 'all' | 'up' | 'down';

const day = (d: string) => formatAsOf(`${d}T12:00:00Z`);
const sinceLabel = (p: ChartPoint) => (p.average ? `ggü. Ø ${p.average} Tage` : `seit ${day(p.date)}`);
const cardCount = (n: number) => (n === 1 ? '1 Karte' : `${n} Karten`);

export function PriceView({ items, catalogs, histories, prefs, setPrefs, fresh }: Props) {
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

  // Sets wie in der Sammlung und im Export: nach Erscheinen, die Karten darin nach der gewählten Sortierung
  const sets = groupBySet(list, (m) => ({ gameId: m.gameId, code: catalogs.lookup(m.gameId, m.printingId)?.setCode ?? '' }), catalogs.sets);
  const order = moverOrder(prefs.priceSort, byNumber);
  for (const g of sets) g.rows.sort(order);
  const collapsed = new Set(prefs.priceCollapsed);

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
              {fresh.has(key) && <em class="tag new">Neu</em>}
            </span>
          </button>
          <MoveCol mover={m} />
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
            <span class="muted">{scrub !== null && shown ? day(shown.date) : 'Sammlung'}</span>
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
              {PRICE_PERIODS.map((p) => (
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
                <SetSection
                  key={g.key}
                  name={g.name}
                  detail={`${cardCount(g.rows.reduce((n, m) => n + m.quantity, 0))} · ${formatEur(g.rows.reduce((n, m) => n + m.to * m.quantity, 0))}`}
                  change={groupChange(g.rows)}
                  open={!collapsed.has(g.key)}
                  onToggle={() => setPrefs({ priceCollapsed: toggled(prefs.priceCollapsed, g.key) })}
                >
                  {g.rows.map(row)}
                </SetSection>
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

/** Runder Skalenschritt (1, 2, 2,5 oder 5 × 10ⁿ) für etwa `count` Abschnitte. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * power;
}

/** Werteskala rechts: Grenzen und Teilstriche auf runden Beträgen. */
function valueScale(values: number[]) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 0.01) {
    const pad = Math.max(0.5, hi * 0.05);
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, 3);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  const digits = step >= 1 ? 0 : 2;
  const format = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
  return { min, max: Math.max(max, min + step), ticks, label: (v: number) => format.format(v) };
}

/** Datumsachse unten: bis zu vier Tage gleichmäßig verteilt, erster und letzter Tag immer dabei. */
function dateTicks(first: number, last: number): number[] {
  const span = last - first;
  const n = Math.min(4, span + 1);
  return [...new Set(Array.from({ length: n }, (_, i) => first + Math.round((span * i) / Math.max(1, n - 1))))];
}

function shortDate(dayNo: number, span: number): string {
  const d = new Date(dayNo * 86_400_000);
  return span > 180
    ? d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/**
 * Wertverlauf wie ein Kurschart: grün bei Gewinn, rot bei Verlust, unten Datum, rechts Werteskala.
 * Antippen und Ziehen (bzw. Maus darüber) zeigt den Wert an diesem Tag.
 */
function ValueChart({ points, active, onScrub }: { points: ChartPoint[]; active: number | null; onScrub(i: number | null): void }) {
  const id = useId();
  const w = 320;
  const h = 170;
  const pad = 6;
  const last = points.length - 1;
  const x0 = dayIndex(points[0].date);
  const x1 = dayIndex(points[last].date);
  const xSpan = x1 - x0 || 1;
  const values = points.map((p) => p.value);
  const scale = valueScale(values);
  const xOf = (dayNo: number) => ((dayNo - x0) / xSpan) * w;
  const x = (i: number) => xOf(dayIndex(points[i].date));
  const y = (v: number) => pad + (1 - (v - scale.min) / (scale.max - scale.min)) * (h - 2 * pad);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
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
          {scale.ticks.map((v) => (
            <line class="grid" x1="0" x2={w} y1={y(v)} y2={y(v)} vector-effect="non-scaling-stroke" />
          ))}
          <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
          <path d={line} class="line" vector-effect="non-scaling-stroke" />
        </svg>
        {active !== null && points[active] && (
          <>
            <span class="cursor" style={{ left: `${(x(active) / w) * 100}%` }} />
            <span class="dot" style={{ left: `${(x(active) / w) * 100}%`, top: `${(y(points[active].value) / h) * 100}%` }} />
          </>
        )}
      </div>
      <div class="y-axis" aria-hidden="true">
        <i class="size">{[...scale.ticks.map(scale.label), formatEur(values[last])].reduce((a, b) => (b.length > a.length ? b : a), '')}</i>
        {scale.ticks
          .filter((v) => Math.abs(y(v) - y(values[last])) > 14)
          .map((v) => (
            <span style={{ top: `${(y(v) / h) * 100}%` }}>{scale.label(v)}</span>
          ))}
        <b class="now" style={{ top: `${(y(values[last]) / h) * 100}%` }}>
          <span>{formatEur(values[last])}</span>
        </b>
      </div>
      <div class="x-axis" aria-hidden="true">
        {dateTicks(x0, x1).map((d, i, all) => (
          <span class={i === 0 ? 'first' : i === all.length - 1 ? 'last' : ''} style={{ left: `${(xOf(d) / w) * 100}%` }}>
            {shortDate(d, xSpan)}
          </span>
        ))}
      </div>
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
