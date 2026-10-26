import { useState } from 'preact/hooks';
import { collectionMovers, collectionSeries, startIndex, STRONG_EUR, STRONG_MIN_EUR, STRONG_PCT, type Mover, type PriceHistoryFile } from '../core/priceHistory';
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
const TOP = 5;
const LIST_LIMIT = 150;

const PCT = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const SIGNED_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const day = (d: string) => formatAsOf(`${d}T12:00:00Z`);
const trend = (delta: number) => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');

export function PriceView({ items, catalogs, histories, prefs, setPrefs }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const days = prefs.pricePeriod;

  const series = collectionSeries(items, histories, catalogs.lookup);
  const dates = series.map((p) => p.date);
  const shown = series.slice(startIndex(dates, days));
  const first = shown[0];
  const last = shown[shown.length - 1];
  const now = collectionValue(items, catalogs.price, catalogs.lookup);
  const change = first && last ? last.value - first.value : 0;

  const movers = collectionMovers(items, histories, catalogs.lookup, days);
  const strong = movers.filter((m) => m.strong);
  const risers = strong.filter((m) => m.delta > 0).sort((a, b) => b.pct - a.pct).slice(0, TOP);
  const fallers = strong.filter((m) => m.delta < 0).sort((a, b) => a.pct - b.pct).slice(0, TOP);
  const all = [...movers].sort((a, b) => Math.abs(b.delta * b.quantity) - Math.abs(a.delta * a.quantity) || b.to - a.to);

  const row = (m: Mover, list: string) => {
    const printing = catalogs.lookup(m.gameId, m.printingId);
    const key = `${list}|${m.gameId}|${m.printingId}|${m.finish}`;
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
              <small class="muted"> statt {formatEur(m.from)}</small>
            </span>
          </button>
          <span class={`delta ${trend(m.delta)}`} title={`${SIGNED_EUR.format(m.delta)} je Karte`}>
            {m.strong && (m.delta > 0 ? '▲ ' : '▼ ')}
            {PCT.format(m.pct)}
          </span>
        </div>
        {expanded && (
          <div class="details">
            <Chart values={m.series} label={`Preisverlauf ${printing?.cardName ?? ''}`} small />
            <small>
              {SIGNED_EUR.format(m.delta)} je Karte
              {m.quantity > 1 ? `, ${SIGNED_EUR.format(m.delta * m.quantity)} für alle ${m.quantity}` : ''}
            </small>
            {url && (
              <a href={url} target="_blank" rel="noopener">
                Bei Cardmarket ansehen ↗
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
        <p class="muted">Wie sich der Wert deiner Sammlung laut Cardmarket entwickelt</p>
      </header>
      <div class="segmented" role="radiogroup" aria-label="Zeitraum">
        {PERIODS.map((p) => (
          <button role="radio" aria-checked={days === p.days} class={days === p.days ? 'active' : ''} onClick={() => setPrefs({ pricePeriod: p.days })}>
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
          <p>Sobald deine Sammlung Karten enthält, siehst du hier, wie sich ihr Wert entwickelt.</p>
        </div>
      ) : (
        <div class="value-card">
          <span class="muted">Wert deiner Sammlung</span>
          <strong class="total">{formatEur(now.total)}</strong>
          {shown.length > 1 && (
            <span class={`change ${trend(change)}`}>
              {change > 0 ? '▲' : change < 0 ? '▼' : ''} {SIGNED_EUR.format(change)} ({PCT.format(first.value > 0 ? change / first.value : 0)}) seit {day(first.date)}
            </span>
          )}
          {shown.length > 1 ? (
            <Chart values={shown.map((p) => p.value)} label="Wert der Sammlung" from={day(first.date)} to={day(last.date)} />
          ) : (
            <p class="muted empty">
              {series.length
                ? `Der Verlauf beginnt am ${day(series[0].date)}. Jeden Tag kommt ein neuer Preisstand dazu.`
                : 'Noch kein Preisverlauf vorhanden. Ab dem nächsten täglichen Preisstand wird er aufgezeichnet.'}
            </p>
          )}
          {now.unpriced > 0 && <small class="muted">{now.unpriced} Karten ohne Preis zählen nicht mit.</small>}
        </div>
      )}

      {items.length > 0 && dates.length > 1 && (
        <>
          <h2>
            Stark gestiegen {risers.length > 0 && <em class="tag up">{strong.filter((m) => m.delta > 0).length}</em>}
          </h2>
          {risers.length ? <ul class="items movers">{risers.map((m) => row(m, 'up'))}</ul> : <p class="muted none">Keine Karte im Zeitraum.</p>}
          <h2>
            Stark gefallen {fallers.length > 0 && <em class="tag down">{strong.filter((m) => m.delta < 0).length}</em>}
          </h2>
          {fallers.length ? <ul class="items movers">{fallers.map((m) => row(m, 'down'))}</ul> : <p class="muted none">Keine Karte im Zeitraum.</p>}
          <p class="muted rule">
            Stark heißt: mindestens {Math.round(STRONG_PCT * 100)} % und {formatEur(STRONG_MIN_EUR)} je Karte, oder {formatEur(STRONG_EUR)} je Karte
            unabhängig vom Anteil.
          </p>
          <h2>Alle Karten</h2>
          <ul class="items movers">{all.slice(0, LIST_LIMIT).map((m) => row(m, 'all'))}</ul>
          {all.length > LIST_LIMIT && <p class="muted">Es werden die {LIST_LIMIT} größten Änderungen angezeigt.</p>}
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
