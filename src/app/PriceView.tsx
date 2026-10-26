import { useState } from 'preact/hooks';
import { basisFor, collectionMovers, collectionSeries, startIndex, type Basis, type Mover, type PriceHistoryFile } from '../core/priceHistory';
import { collectionValue, formatAsOf, formatEur } from '../core/prices';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { printingCode } from './format';
import type { Prefs } from './prefs';

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
const PAGE = 100;

type Filter = 'all' | 'up' | 'down';

const PCT = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const SIGNED_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const day = (d: string) => formatAsOf(`${d}T12:00:00Z`);
const trend = (delta: number) => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
const arrow = (delta: number) => (delta > 0 ? '▲' : delta < 0 ? '▼' : '');
const basisLabel = (b: Basis) => (b.kind === 'history' ? `seit ${day(b.since)}` : `ggü. Ø ${b.days} Tage`);

export function PriceView({ items, catalogs, histories, prefs, setPrefs }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [lowestFirst, setLowestFirst] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const days = prefs.pricePeriod;

  const series = collectionSeries(items, histories, catalogs.lookup);
  const shown = series.slice(startIndex(series.map((p) => p.date), days));
  const now = collectionValue(items, catalogs.price, catalogs.lookup);

  const movers = collectionMovers(items, histories, catalogs.lookup, days, catalogs.price);
  const basis = movers[0]?.basis ?? basisFor(histories.get(items[0]?.gameId ?? ''), days);
  const fromTotal = movers.reduce((n, m) => n + m.from * m.quantity, 0);
  const toTotal = movers.reduce((n, m) => n + m.to * m.quantity, 0);
  const change = toTotal - fromTotal;
  const ups = movers.filter((m) => m.strong && m.delta > 0).length;
  const downs = movers.filter((m) => m.strong && m.delta < 0).length;
  const list = movers
    .filter((m) => filter === 'all' || (m.strong && (filter === 'up' ? m.delta > 0 : m.delta < 0)))
    .sort((a, b) => (lowestFirst ? a.pct - b.pct : b.pct - a.pct) || Math.abs(b.delta * b.quantity) - Math.abs(a.delta * a.quantity) || b.to - a.to);

  const pick = (f: Filter) => {
    setFilter(f);
    setLimit(PAGE);
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
            {m.series.length > 1 && <Chart values={m.series} label={`Preisverlauf ${printing?.cardName ?? ''}`} small />}
            <small>
              {SIGNED_EUR.format(m.delta)} je Karte
              {m.quantity > 1 ? ` · ${SIGNED_EUR.format(m.delta * m.quantity)} für ${m.quantity}` : ''} · {basisLabel(m.basis)}
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
      <div class="segmented" role="radiogroup" aria-label="Zeitraum">
        {PERIODS.map((p) => (
          <button
            role="radio"
            aria-checked={days === p.days}
            class={days === p.days ? 'active' : ''}
            onClick={() => {
              setPrefs({ pricePeriod: p.days });
              setLimit(PAGE);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

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
            <span class="muted">Sammlung</span>
            <strong class="total">{formatEur(now.total)}</strong>
            {movers.length > 0 && (
              <span class="change-row">
                <span class={`change ${trend(change)}`}>
                  {arrow(change)} {SIGNED_EUR.format(change)} · {PCT.format(fromTotal > 0 ? change / fromTotal : 0)}
                </span>
                <small class="muted">{basisLabel(basis)}</small>
              </span>
            )}
            {shown.length > 1 && <Chart values={shown.map((p) => p.value)} label="Wert der Sammlung" from={day(shown[0].date)} to={day(shown[shown.length - 1].date)} />}
            {now.unpriced > 0 && <small class="muted">{now.unpriced} ohne Preis</small>}
          </div>

          <div class="list-head">
            <h2>Deine Karten</h2>
            <button class="small sort-dir" aria-label={lowestFirst ? 'Höchste zuerst' : 'Niedrigste zuerst'} onClick={() => setLowestFirst(!lowestFirst)}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d={lowestFirst ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6'}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              {lowestFirst ? 'Niedrigste %' : 'Höchste %'}
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
              <button role="radio" aria-checked={filter === value} class={`${filter === value ? 'active' : ''} ${value}`} onClick={() => pick(value)}>
                {label}
              </button>
            ))}
          </div>
          {list.length ? (
            <ol class="items movers">{list.slice(0, limit).map(row)}</ol>
          ) : (
            <p class="muted none">{movers.length ? 'Keine Karte' : 'Noch keine Vergleichspreise'}</p>
          )}
          {list.length > limit && (
            <button class="more" onClick={() => setLimit(limit + PAGE)}>
              Mehr anzeigen ({list.length - limit})
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Linie mit Fläche, violett wie der Akzent. */
function Chart({ values, label, from, to, small }: { values: number[]; label: string; from?: string; to?: string; small?: boolean }) {
  if (values.length < 2) return null;
  const w = 320;
  const h = small ? 64 : 140;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, max * 0.1);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => 6 + (1 - (v - min) / span) * (h - 12);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <figure class={`chart ${small ? 'small' : ''}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent-text)" stop-opacity="0.28" />
            <stop offset="1" stop-color="var(--accent-text)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${w},${h}L0,${h}Z`} class="area" />
        <path d={line} class="line" vector-effect="non-scaling-stroke" />
      </svg>
      {!small && (
        <figcaption>
          <span>{from}</span>
          <span>
            {formatEur(min)} – {formatEur(max)}
          </span>
          <span>{to}</span>
        </figcaption>
      )}
    </figure>
  );
}
