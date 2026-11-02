import { useMemo, useState } from 'preact/hooks';
import { byCost, DECK_RULES, deckValue, mainCount, missingCount, type CardKind, type Deck, type DeckCard, type DeckPool } from '../core/deck';
import { buildFromMeta, deckFromList, playRate, type MetaDeck, type MetaFile, type MetaStats } from '../core/meta';
import { formatEur } from '../core/prices';
import { Sheet } from './Sheet';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const day = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`));
const pct = (x: number) => `${Math.round(x * 100)} %`;
/** Wie im Deck: Einheiten, Zauber, Ausrüstung, jeweils nach Kosten. */
const KIND_ORDER: Partial<Record<CardKind, number>> = { unit: 1, spell: 2, gear: 3 };
const byKind = (a: DeckCard, b: DeckCard) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || byCost(a, b);
/** So viele Turnierdecks zeigt die Liste zuerst. */
const FIRST_LISTS = 8;

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
  const [allLists, setAllLists] = useState(false);
  const built = useMemo(() => buildFromMeta(deck, stats, pool, { owned, preferOwned }), [deck, stats, pool, owned, preferOwned]);
  const missing = missingCount(built, owned);
  const value = deckValue(built, pool, priceOf);
  const replaces = mainCount(deck) > 1 || Object.keys(deck.runes).length > 0 || deck.battlefields.length > 0;

  // Sortiert wie im Deck
  const cards = Object.entries(built.cards)
    .map(([id, n]) => ({ card: pool.cards.get(id)!, n }))
    .filter((e) => e.card)
    .sort((a, b) => byKind(a.card, b.card));
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
        {stats.community > 0 &&
          ` Weil es wenige Turnierlisten gibt, zählen ${stats.community} veröffentlichte Decks der Community mit, aber schwächer.`}
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
      <p class="meta-note">
        Prozent: in so vielen Listen gespielt. Blasse Karten fehlen dir. Dazu kommen {DECK_RULES.runes} Runen im Verhältnis der Listen, die 3 meistgespielten
        Battlefields und ein Side Deck aus den Sideboards.
      </p>

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
      {replaces && <p class="meta-note center">Ersetzt Hauptdeck, Side Deck, Runen und Battlefields. Legende und Champion bleiben.</p>}

      {stats.lists.length > 0 && (
        <>
          <h3 class="meta-lists-head">Turnierdecks</h3>
          <ul class="meta-lists">
            {stats.lists.slice(0, allLists ? undefined : FIRST_LISTS).map((list) => (
              <ListRow
                key={list.id}
                list={list}
                champion={championOf(list, stats, pool)}
                onApply={() => {
                  onApply(deckFromList(deck, list, stats.legend, pool));
                  onClose();
                }}
              />
            ))}
          </ul>
          {!allLists && stats.lists.length > FIRST_LISTS && (
            <button class="link meta-more" onClick={() => setAllLists(true)}>
              Alle {stats.lists.length} Turnierdecks zeigen
            </button>
          )}
        </>
      )}
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

/** Champion-Einheit der Legende, die die Liste spielt (für die Zeile). */
function championOf(list: MetaDeck, stats: MetaStats, pool: DeckPool): DeckCard | undefined {
  let best: { card: DeckCard; n: number } | undefined;
  for (const [printingId, n] of Object.entries(list.cards)) {
    const card = pool.cardOf(printingId);
    if (card?.champion && card.championOf === stats.legend.championOf && (!best || n > best.n)) best = { card, n };
  }
  return best?.card;
}

function ListRow({ list, champion, onApply }: { list: MetaDeck; champion?: DeckCard; onApply(): void }) {
  return (
    <li class="meta-list">
      <b class={`meta-place${list.place === 1 ? ' first' : list.place && list.place <= 8 ? ' top' : ''}`}>{list.place ? `${list.place}.` : '–'}</b>
      <span>
        <strong>{list.event}</strong>
        <small>
          {day(list.date)}
          {champion ? ` · ${champion.title ?? champion.name}` : ''}
        </small>
      </span>
      <button class="small" onClick={onApply} aria-label={`Deck vom ${list.place ? `${list.place}. Platz ` : ''}${list.event} übernehmen`}>
        Übernehmen
      </button>
    </li>
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
