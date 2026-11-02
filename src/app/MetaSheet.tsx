import { useMemo, useState } from 'preact/hooks';
import { DECK_RULES, deckValue, mainCount, missingCount, type Deck, type DeckCard, type DeckPool } from '../core/deck';
import { buildFromMeta, playRate, type MetaFile, type MetaStats } from '../core/meta';
import { formatEur } from '../core/prices';
import { Sheet } from './Sheet';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const day = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`));
const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * Deck aus der Turnier-Meta bauen: zeigt, worauf der Vorschlag beruht, das vorgeschlagene Hauptdeck als
 * kleines Raster (fehlende Karten blass) und übernimmt es auf Wunsch. Legende und Champion bleiben.
 */
export function MetaSheet(props: {
  deck: Deck;
  stats: MetaStats;
  meta: MetaFile;
  pool: DeckPool;
  owned: Map<string, number>;
  priceOf(card: DeckCard): number | undefined;
  onApply(deck: Deck): void;
  onClose(): void;
}) {
  const { deck, stats, meta, pool, owned, priceOf, onApply, onClose } = props;
  const [preferOwned, setPreferOwned] = useState(false);
  const built = useMemo(() => buildFromMeta(deck, stats, pool, { owned, preferOwned }), [deck, stats, pool, owned, preferOwned]);
  const missing = missingCount(built, owned);
  const value = deckValue(built, pool, priceOf);
  const replaces = mainCount(deck) > 1 || Object.keys(deck.runes).length > 0 || deck.battlefields.length > 0;

  // Hauptdeck nach Spielrate: Karten, die fast alle spielen, zuerst
  const cards = Object.entries(built.cards)
    .map(([id, n]) => ({ card: pool.cards.get(id)!, n }))
    .filter((e) => e.card)
    .sort((a, b) => playRate(stats, b.card.id) - playRate(stats, a.card.id) || a.card.id.localeCompare(b.card.id));
  const core = cards.filter((e) => playRate(stats, e.card.id) >= 0.75).length;
  const champion = pool.cards.get(built.champion);

  return (
    <Sheet class="meta-sheet" label="Deck aus der Meta" onClose={onClose}>
      <h2>
        {sparkIcon}
        Deck aus der Meta
      </h2>
      <p class="muted">
        Aus {stats.decks} {stats.decks === 1 ? 'Turnierliste' : 'Turnierlisten'} mit {stats.legend.championOf ?? stats.legend.name}
        {stats.events > 1 ? ` von ${stats.events} Turnieren` : ''}
        {stats.oldest && stats.newest ? ` (${stats.oldest === stats.newest ? day(stats.newest) : `${day(stats.oldest)} bis ${day(stats.newest)}`})` : ''}.{' '}
        Neue Turniere und bessere Plätze zählen mehr.
      </p>
      {stats.best && (
        <p class="meta-best">
          {trophyIcon}
          <span>
            Bestes Ergebnis: <strong>{stats.best.place}. Platz</strong> bei {stats.best.event}
          </span>
        </p>
      )}

      <div class="meta-sum">
        <span>
          <strong>{mainCount(built)}</strong>
          <small>Karten</small>
        </span>
        <span>
          <strong>{core}</strong>
          <small>Kernkarten</small>
        </span>
        <span class={missing ? 'warn' : 'ok'}>
          <strong>{missing}</strong>
          <small>fehlen dir</small>
        </span>
        {value !== undefined && (
          <span>
            <strong>{formatEur(value)}</strong>
            <small>Wert</small>
          </span>
        )}
      </div>

      <div class="meta-grid" aria-label="Vorgeschlagenes Hauptdeck">
        {champion && <MetaTile card={champion} n={1} have={owned.get(champion.id) ?? 0} rate={playRate(stats, champion.id)} champ />}
        {cards.map(({ card, n }) => (
          <MetaTile card={card} n={n} have={Math.max(0, (owned.get(card.id) ?? 0) - (card.id === built.champion ? 1 : 0))} rate={playRate(stats, card.id)} />
        ))}
      </div>
      <p class="meta-note">Prozent: in so vielen Listen gespielt. Blasse Karten fehlen dir. Dazu kommen {DECK_RULES.runes} Runen im Verhältnis der Listen und die 3 meistgespielten Battlefields.</p>

      <label class="check">
        <input type="checkbox" checked={preferOwned} onChange={(e) => setPreferOwned(e.currentTarget.checked)} />
        Karten aus meiner Sammlung bevorzugen
      </label>

      <button
        class="primary"
        onClick={() => {
          onApply(built);
          onClose();
        }}
      >
        {replaces ? 'Deck ersetzen' : 'Deck übernehmen'}
      </button>
      {replaces && <p class="meta-note center">Ersetzt Hauptdeck, Runen und Battlefields. Legende und Champion bleiben.</p>}
      <p class="meta-note center">
        Turnierlisten von{' '}
        <a href={meta.sourceUrl} target="_blank" rel="noopener">
          {meta.source}
        </a>
        , Stand {DATE.format(new Date(meta.builtAt))}
      </p>
    </Sheet>
  );
}

function MetaTile({ card, n, have, rate, champ }: { card: DeckCard; n: number; have: number; rate: number; champ?: boolean }) {
  const lacking = Math.max(0, n - have);
  return (
    <span class={`meta-tile${lacking === n ? ' lacking' : ''}${champ ? ' champ' : ''}`} title={`${card.id}: ${n}×, in ${pct(rate)} der Listen${lacking ? `, ${lacking} fehlen dir` : ''}`}>
      <img src={card.printing.thumbUrl ?? card.printing.imageUrl} alt={card.id} loading="lazy" />
      <b class="meta-n">{n}×</b>
      <small class="meta-rate">{pct(rate)}</small>
      {lacking > 0 && lacking < n && <i class="meta-lack">−{lacking}</i>}
    </span>
  );
}

export const sparkIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor" />
  </svg>
);

const trophyIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
