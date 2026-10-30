import { useMemo, useRef, useState } from 'preact/hooks';
import {
  battlefieldsOf,
  championsFor,
  checkDeck,
  copiesOf,
  DECK_GAMES,
  DECK_RULES,
  deckPool,
  deckValue,
  evenRunes,
  mainCardsFor,
  missingCount,
  newDeck,
  ownedByCard,
  room,
  runesFor,
  toggleBattlefield,
  withCard,
  withChampion,
  withRune,
  type CardKind,
  type Deck,
  type DeckCard,
  type DeckPool,
} from '../core/deck';
import { newId } from '../core/collection';
import { formatEur, priceFor } from '../core/prices';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { Sheet } from './Sheet';
import { cardSrcSet, printingCode } from './format';

interface Props {
  catalogs: Catalogs;
  items: CollectionItem[];
  decks: Deck[];
  gameId: string;
  onSave(deck: Deck): void;
  onDelete(deckId: string): void;
}

type Screen = { kind: 'list' } | { kind: 'legend' } | { kind: 'champion'; legend: string; deckId?: string } | { kind: 'edit'; deckId: string };
type Part = 'cards' | 'runes' | 'battlefields';
type Filter = 'all' | 'deck' | 'unit' | 'spell' | 'gear';

const KIND_LABEL: Record<CardKind, string> = { legend: 'Legende', unit: 'Einheit', spell: 'Zauber', gear: 'Ausrüstung', rune: 'Rune', battlefield: 'Battlefield' };
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'deck', label: 'Im Deck' },
  { value: 'unit', label: 'Einheiten' },
  { value: 'spell', label: 'Zauber' },
  { value: 'gear', label: 'Ausrüstung' },
];
/** Reihenfolge der Domains wie auf dem Farbrad des Spiels. */
const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];

/** Name im Deck: Champions mit Titel, Legenden mit ihrem Champion. */
const cardTitle = (c: DeckCard) => c.id;
const legendTitle = (c: DeckCard) => c.championOf ?? c.name;

export function DeckView({ catalogs, items, decks, gameId, onSave, onDelete }: Props) {
  const pool = useMemo(
    () => (DECK_GAMES.includes(gameId) ? deckPool(gameId, catalogs.ordered.get(gameId) ?? [], catalogs.sets.get(gameId) ?? []) : null),
    [catalogs, gameId],
  );
  const owned = useMemo(() => (pool ? ownedByCard(items, pool) : new Map<string, number>()), [items, pool]);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [shown, setShown] = useState<DeckCard | null>(null);

  if (!pool) {
    return (
      <section class="decks">
        <header>
          <h1>Decks</h1>
        </header>
        <div class="empty-state">
          <strong>Für dieses Spiel gibt es noch keinen Deckbau</strong>
        </div>
      </section>
    );
  }

  const priceOf = (card: DeckCard) => {
    const finish = card.printing.finishes?.length === 1 && card.printing.finishes[0] === 'foil' ? 'foil' : 'normal';
    return priceFor(catalogs.price(gameId, card.printing.printingId), finish, card.printing);
  };
  const sheet = shown && <CardSheet card={shown} owned={owned.get(shown.id) ?? 0} price={priceOf(shown)} url={catalogs.price(gameId, shown.printing.printingId)?.url} onClose={() => setShown(null)} />;

  if (screen.kind === 'legend') {
    return (
      <>
        <LegendPicker pool={pool} onBack={() => setScreen({ kind: 'list' })} onPick={(legend) => setScreen({ kind: 'champion', legend: legend.id })} onShow={setShown} />
        {sheet}
      </>
    );
  }

  if (screen.kind === 'champion') {
    const legend = pool.cards.get(screen.legend)!;
    const deck = screen.deckId ? decks.find((d) => d.deckId === screen.deckId) : undefined;
    return (
      <>
        <ChampionPicker
          legend={legend}
          pool={pool}
          current={deck?.champion}
          backLabel={deck ? deck.name : 'Legende'}
          onBack={() => setScreen(deck ? { kind: 'edit', deckId: deck.deckId } : { kind: 'legend' })}
          onPick={(champion) => {
            if (deck) {
              onSave(withChampion(deck, champion));
              setScreen({ kind: 'edit', deckId: deck.deckId });
              return;
            }
            const created = newDeck(gameId, legend, champion, newId(), new Date().toISOString());
            onSave(created);
            setScreen({ kind: 'edit', deckId: created.deckId });
          }}
          onShow={setShown}
        />
        {sheet}
      </>
    );
  }

  if (screen.kind === 'edit') {
    const deck = decks.find((d) => d.deckId === screen.deckId);
    if (deck) {
      return (
        <>
          <DeckEditor
            key={deck.deckId}
            initial={deck}
            pool={pool}
            owned={owned}
            onSave={onSave}
            onBack={() => setScreen({ kind: 'list' })}
            onChangeChampion={() => setScreen({ kind: 'champion', legend: deck.legend, deckId: deck.deckId })}
            onDelete={() => {
              if (!confirm(`Deck „${deck.name}“ löschen?`)) return;
              onDelete(deck.deckId);
              setScreen({ kind: 'list' });
            }}
            onShow={setShown}
          />
          {sheet}
        </>
      );
    }
  }

  return (
    <section class="decks">
      <header class="title-row">
        <h1>Decks</h1>
      </header>
      {pool.legends.length > 0 && !pool.legends.some((l) => l.championOf) && <p class="banner">Kartendaten werden aktualisiert. Bitte die App gleich neu öffnen.</p>}
      {decks.length > 0 ? (
        <>
          <button class="primary new-deck" onClick={() => setScreen({ kind: 'legend' })}>
            {plusIcon}
            Neues Deck
          </button>
          <ul class="deck-list">
            {decks.map((deck) => (
              <DeckRow key={deck.deckId} deck={deck} pool={pool} owned={owned} priceOf={priceOf} onOpen={() => setScreen({ kind: 'edit', deckId: deck.deckId })} />
            ))}
          </ul>
        </>
      ) : (
        <div class="empty-state">
          {deckIcon}
          <strong>Noch keine Decks</strong>
          <button class="primary" onClick={() => setScreen({ kind: 'legend' })}>
            {plusIcon}
            Neues Deck
          </button>
        </div>
      )}
    </section>
  );
}

function DeckRow({ deck, pool, owned, priceOf, onOpen }: { deck: Deck; pool: DeckPool; owned: Map<string, number>; priceOf(card: DeckCard): number | undefined; onOpen(): void }) {
  const legend = pool.cards.get(deck.legend);
  const champion = pool.cards.get(deck.champion);
  const check = checkDeck(deck, pool);
  const value = deckValue(deck, pool, priceOf);
  const missing = missingCount(deck, owned);
  return (
    <li>
      <button class="deck-row" onClick={onOpen}>
        {(champion ?? legend) && <img src={(champion ?? legend)!.printing.thumbUrl ?? (champion ?? legend)!.printing.imageUrl} alt="" loading="lazy" />}
        <span class="info">
          <strong>{deck.name}</strong>
          <small>{legend ? `${legendTitle(legend)} · ${legend.name}` : deck.legend}</small>
          <span class="line">
            {check.complete ? <em class="tag ok">Vollständig</em> : <em class="tag warn">{check.problems[0]}</em>}
            {value !== undefined && <span class="price">{formatEur(value)}</span>}
            {missing > 0 && <small class="muted">{missing} fehlen dir</small>}
          </span>
        </span>
        {chevron}
      </button>
    </li>
  );
}

function LegendPicker({ pool, onBack, onPick, onShow }: { pool: DeckPool; onBack(): void; onPick(legend: DeckCard): void; onShow(card: DeckCard): void }) {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const legends = pool.legends.filter(
    (l) => (!domain || l.domains.includes(domain)) && (!q || `${l.championOf} ${l.name}`.toLowerCase().includes(q)),
  );
  return (
    <section class="decks">
      <header class="friend-head">
        <button class="link back" onClick={onBack}>
          ‹ Decks
        </button>
        <h1>Legende wählen</h1>
      </header>
      <div class="find">
        <input type="search" enterkeyhint="search" placeholder="Champion suchen" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </div>
      <div class="chips filters" role="radiogroup" aria-label="Domain">
        <button role="radio" aria-checked={!domain} class={!domain ? 'active' : ''} onClick={() => setDomain(null)}>
          Alle
        </button>
        {DOMAINS.map((d) => (
          <button role="radio" aria-checked={domain === d} class={domain === d ? 'active' : ''} onClick={() => setDomain(domain === d ? null : d)}>
            <DomainDot domain={d} />
            {d}
          </button>
        ))}
      </div>
      {legends.length ? (
        <div class="pick-grid">
          {legends.map((l) => (
            <PickCard key={l.id} card={l} title={legendTitle(l)} detail={l.name} onPick={() => onPick(l)} onShow={() => onShow(l)} />
          ))}
        </div>
      ) : (
        <p class="muted none">Keine Legende</p>
      )}
    </section>
  );
}

function ChampionPicker(props: {
  legend: DeckCard;
  pool: DeckPool;
  current?: string;
  backLabel: string;
  onBack(): void;
  onPick(champion: DeckCard): void;
  onShow(card: DeckCard): void;
}) {
  const { legend, pool, current, backLabel, onBack, onPick, onShow } = props;
  const champions = championsFor(legend, pool);
  return (
    <section class="decks">
      <header class="friend-head">
        <button class="link back" onClick={onBack}>
          ‹ {backLabel}
        </button>
        <h1>Champion wählen</h1>
        <p class="muted legend-line">
          <Domains domains={legend.domains} />
          {legendTitle(legend)} · {legend.name}
        </p>
      </header>
      {champions.length ? (
        <div class="pick-grid">
          {champions.map((c) => (
            <PickCard
              key={c.id}
              card={c}
              title={c.title ?? c.name}
              detail={c.energy !== null ? `${c.energy} Energie` : ''}
              active={c.id === current}
              onPick={() => onPick(c)}
              onShow={() => onShow(c)}
            />
          ))}
        </div>
      ) : (
        <div class="empty-state">
          <strong>Kein passender Champion im Katalog</strong>
        </div>
      )}
    </section>
  );
}

/** Karte zum Auswählen: Tipp wählt, die Lupe zeigt die Karte groß. */
function PickCard({ card, title, detail, active, onPick, onShow }: { card: DeckCard; title: string; detail: string; active?: boolean; onPick(): void; onShow(): void }) {
  return (
    <div class={`pick${active ? ' active' : ''}`}>
      <button class="pick-main" onClick={onPick} aria-pressed={active}>
        <img
          src={card.printing.imageUrl}
          srcset={cardSrcSet(card.printing.imageUrl, [240, 360, 480])}
          sizes="(min-width: 720px) 150px, 31vw"
          alt=""
          loading="lazy"
        />
        <strong>{title}</strong>
        <small>
          <Domains domains={card.domains} />
          {detail}
        </small>
      </button>
      <button class="pick-zoom" onClick={onShow} aria-label={`${title} groß ansehen`}>
        {zoomIcon}
      </button>
    </div>
  );
}

function DeckEditor(props: {
  initial: Deck;
  pool: DeckPool;
  owned: Map<string, number>;
  onSave(deck: Deck): void;
  onBack(): void;
  onChangeChampion(): void;
  onDelete(): void;
  onShow(card: DeckCard): void;
}) {
  const { initial, pool, owned, onSave, onBack, onChangeChampion, onDelete, onShow } = props;
  const [deck, setDeck] = useState(initial);
  // Schnelle Tipps hintereinander bauen aufeinander auf, nicht auf einem veralteten Stand
  const current = useRef(initial);
  const change = (update: (d: Deck) => Deck) => {
    const next = update(current.current);
    if (next === current.current) return;
    current.current = next;
    setDeck(next);
    onSave(next);
  };
  const [part, setPart] = useState<Part>('cards');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [bfQuery, setBfQuery] = useState('');
  const [bfChosenOnly, setBfChosenOnly] = useState(false);

  const legend = pool.cards.get(deck.legend);
  const champion = pool.cards.get(deck.champion);
  const mainCards = useMemo(() => (legend ? mainCardsFor(legend, pool) : []), [legend, pool]);
  const runes = useMemo(() => (legend ? runesFor(legend, pool) : []), [legend, pool]);
  const battlefields = useMemo(() => battlefieldsOf(pool), [pool]);
  const check = checkDeck(deck, pool);

  const q = query.trim().toLowerCase();
  const shownCards = mainCards.filter((c) => {
    if (q && !c.id.toLowerCase().includes(q)) return false;
    if (filter === 'deck') return copiesOf(deck, c.id) > 0;
    if (filter !== 'all') return c.kind === filter;
    return true;
  });
  const bq = bfQuery.trim().toLowerCase();
  const shownBattlefields = battlefields.filter((b) => (!bfChosenOnly || deck.battlefields.includes(b.id)) && (!bq || b.name.toLowerCase().includes(bq)));
  const inDeck = check.main;

  const has = (c: DeckCard, needed: number) => {
    const n = owned.get(c.id) ?? 0;
    return n >= needed ? null : <em class="tag">{n ? `${n} in Sammlung` : 'nicht in Sammlung'}</em>;
  };

  const cardRow = (c: DeckCard) => {
    const copies = copiesOf(deck, c.id);
    const isChampion = c.id === deck.champion;
    return (
      <li key={c.id} class={copies ? 'in-deck' : ''}>
        <div class="main">
          <button class="thumb" onClick={() => onShow(c)} aria-label={`${cardTitle(c)} groß ansehen`}>
            <img src={c.printing.thumbUrl ?? c.printing.imageUrl} alt="" loading="lazy" />
          </button>
          <button class="info" onClick={() => onShow(c)}>
            <strong>{cardTitle(c)}</strong>
            <small>
              <Domains domains={c.domains} />
              {KIND_LABEL[c.kind]}
              {c.energy !== null ? ` · ${c.energy} Energie` : ''}
            </small>
            {(isChampion || c.signature || copies > 0) && (
              <span class="line">
                {isChampion && <em class="tag accent">Champion</em>}
                {c.signature && <em class="tag">Signature</em>}
                {copies > 0 && has(c, copies)}
              </span>
            )}
          </button>
          <div class="qty">
            <button onClick={() => change((d) => withCard(d, c, -1, pool))} disabled={!deck.cards[c.id]} aria-label={`${cardTitle(c)}: eine weniger`}>
              −
            </button>
            <span>{copies}</span>
            <button onClick={() => change((d) => withCard(d, c, 1, pool))} disabled={room(deck, c, pool) === 0} aria-label={`${cardTitle(c)}: eine mehr`}>
              +
            </button>
          </div>
        </div>
      </li>
    );
  };

  return (
    <section class="decks deck-edit">
      <header class="friend-head">
        <button class="link back" onClick={onBack}>
          ‹ Decks
        </button>
        <input
          class="deck-name"
          value={deck.name}
          aria-label="Name des Decks"
          maxLength={40}
          enterkeyhint="done"
          onChange={(e) => {
            const name = e.currentTarget.value.trim();
            if (name) change((d) => ({ ...d, name }));
            else e.currentTarget.value = current.current.name;
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </header>
      <div class="deck-heads">
        {legend && (
          <button class="deck-head" onClick={() => onShow(legend)}>
            <img src={legend.printing.thumbUrl ?? legend.printing.imageUrl} alt="" />
            <span>
              <small>Legende</small>
              <strong>{legendTitle(legend)}</strong>
              <small>
                <Domains domains={legend.domains} />
                {legend.name}
              </small>
            </span>
          </button>
        )}
        <button class="deck-head" onClick={onChangeChampion} aria-label="Champion ändern">
          {champion && <img src={champion.printing.thumbUrl ?? champion.printing.imageUrl} alt="" />}
          <span>
            <small>Champion</small>
            <strong>{champion?.name ?? '–'}</strong>
            <small>{champion?.title ?? ''}</small>
          </span>
        </button>
      </div>
      <div class="segmented deck-parts" role="radiogroup" aria-label="Teil des Decks">
        {(
          [
            ['cards', 'Karten', inDeck, DECK_RULES.main],
            ['runes', 'Runen', check.runes, DECK_RULES.runes],
            ['battlefields', 'Battlefields', check.battlefields, DECK_RULES.battlefields],
          ] as const
        ).map(([value, label, n, of]) => (
          <button role="radio" aria-checked={part === value} class={part === value ? 'active' : ''} onClick={() => setPart(value)}>
            <span>{label}</span>
            <small class={n >= of ? 'done' : ''}>
              {n}/{of}
            </small>
          </button>
        ))}
      </div>
      <p class="deck-status">
        <span role="status">{check.complete ? <em class="tag ok">Deck vollständig</em> : <span class="muted">{check.problems.slice(0, 3).join(' · ')}</span>}</span>
        {/* Ablauf wie beim Bauen: erst Karten, dann Runen, dann Battlefields */}
        {part === 'cards' && check.main >= DECK_RULES.main && check.runes < DECK_RULES.runes && (
          <button class="link" onClick={() => setPart('runes')}>
            Weiter zu den Runen ›
          </button>
        )}
        {part !== 'battlefields' && check.main >= DECK_RULES.main && check.runes === DECK_RULES.runes && check.battlefields < DECK_RULES.battlefields && (
          <button class="link" onClick={() => setPart('battlefields')}>
            Weiter zu den Battlefields ›
          </button>
        )}
      </p>

      {part === 'cards' && (
        <>
          {/* Beim Scrollen bleibt oben, wie viele Karten schon im Deck sind */}
          <div class="find">
            <input type="search" enterkeyhint="search" placeholder="Karte suchen" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
            <span class={`find-count${inDeck >= DECK_RULES.main ? ' done' : ''}`} aria-hidden="true">
              {inDeck}/{DECK_RULES.main}
            </span>
          </div>
          <div class="chips filters" role="radiogroup" aria-label="Kartenart">
            {FILTERS.map((f) => (
              <button role="radio" aria-checked={filter === f.value} class={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
                {f.value === 'deck' ? ` ${inDeck}` : ''}
              </button>
            ))}
          </div>
          {check.signatures > 0 && (
            <small class="muted rule-note">
              Signature-Karten {check.signatures}/{DECK_RULES.signatures}
            </small>
          )}
          {shownCards.length ? <ol class="items deck-cards">{shownCards.map(cardRow)}</ol> : <p class="muted none">Keine Karte</p>}
        </>
      )}

      {part === 'runes' && (
        <>
          <ol class="items deck-cards">
            {runes.map((r) => {
              const n = deck.runes[r.id] ?? 0;
              return (
                <li key={r.id} class={n ? 'in-deck' : ''}>
                  <div class="main">
                    <button class="thumb" onClick={() => onShow(r)} aria-label={`${r.name} groß ansehen`}>
                      <img src={r.printing.thumbUrl ?? r.printing.imageUrl} alt="" loading="lazy" />
                    </button>
                    <span class="info">
                      <strong>{r.name}</strong>
                      <small>
                        <Domains domains={r.domains} />
                        {r.domains.join(', ')}
                      </small>
                      {n > 0 && <span class="line">{has(r, n)}</span>}
                    </span>
                    <div class="qty">
                      <button onClick={() => change((d) => withRune(d, r, -1, runes))} disabled={!n} aria-label={`${r.name}: eine weniger`}>
                        −
                      </button>
                      <span>{n}</span>
                      <button onClick={() => change((d) => withRune(d, r, 1, runes))} disabled={check.runes >= DECK_RULES.runes && n === check.runes} aria-label={`${r.name}: eine mehr`}>
                        +
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {check.runes === 0 && runes.length > 1 && (
            <button class="even-runes" onClick={() => change((d) => evenRunes(d, runes))}>
              Je {DECK_RULES.runes / runes.length} verteilen
            </button>
          )}
        </>
      )}

      {part === 'battlefields' && (
        <>
          <div class="find">
            <input type="search" enterkeyhint="search" placeholder="Battlefield suchen" value={bfQuery} onInput={(e) => setBfQuery(e.currentTarget.value)} />
          </div>
          <label class="check">
            <input type="checkbox" checked={bfChosenOnly} onChange={(e) => setBfChosenOnly(e.currentTarget.checked)} />
            Nur gewählte
          </label>
          {shownBattlefields.length ? (
            <ol class="items deck-cards">
              {shownBattlefields.map((b) => {
                const chosen = deck.battlefields.includes(b.id);
                const full = !chosen && deck.battlefields.length >= DECK_RULES.battlefields;
                return (
                  <li key={b.id} class={chosen ? 'in-deck' : ''}>
                    <div class="main">
                      <button class="thumb landscape" onClick={() => onShow(b)} aria-label={`${b.name} groß ansehen`}>
                        <img src={b.printing.thumbUrl ?? b.printing.imageUrl} alt="" loading="lazy" />
                      </button>
                      <span class="info">
                        <strong>{b.name}</strong>
                        <small>{printingCode(b.printing)}</small>
                        {chosen && <span class="line">{has(b, 1)}</span>}
                      </span>
                      <button
                        class={`pick-toggle${chosen ? ' on' : ''}`}
                        role="checkbox"
                        aria-checked={chosen}
                        aria-label={b.name}
                        disabled={full}
                        onClick={() => change((d) => toggleBattlefield(d, b))}
                      >
                        {checkIcon}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p class="muted none">Kein Battlefield</p>
          )}
        </>
      )}

      <button class="link remove-friend" onClick={onDelete}>
        Deck löschen
      </button>
    </section>
  );
}

function CardSheet({ card, owned, price, url, onClose }: { card: DeckCard; owned: number; price?: number; url?: string; onClose(): void }) {
  const landscape = card.printing.attributes?.orientation === 'landscape';
  return (
    <Sheet class="binder-card" label={cardTitle(card)} onClose={onClose}>
      <img
        class={landscape ? 'landscape' : ''}
        src={card.printing.imageUrl}
        srcset={cardSrcSet(card.printing.imageUrl, [480, 720, 960])}
        sizes={landscape ? 'min(86vw, 420px)' : 'min(62vw, 260px)'}
        alt={cardTitle(card)}
      />
      <div class="binder-card-info">
        <h2>{card.kind === 'legend' ? `${legendTitle(card)} · ${card.name}` : cardTitle(card)}</h2>
        <small class="muted">
          <Domains domains={card.domains} />
          {KIND_LABEL[card.kind]}
          {card.energy !== null ? ` · ${card.energy} Energie` : ''} · {printingCode(card.printing)}
        </small>
        <span class="line">
          <em class="tag">{owned ? `${owned} in Sammlung` : 'Nicht in Sammlung'}</em>
          {price !== undefined && <span class="price">{formatEur(price)}</span>}
        </span>
        {url && (
          <a href={url} target="_blank" rel="noopener">
            Bei Cardmarket ansehen ↗
          </a>
        )}
      </div>
    </Sheet>
  );
}

/** Farbpunkte der Domains (farblose Karten ohne Punkt). */
function Domains({ domains }: { domains: string[] }) {
  const shown = domains.filter((d) => DOMAINS.includes(d));
  if (!shown.length) return null;
  return (
    <span class="domains" aria-label={shown.join(', ')}>
      {shown.map((d) => (
        <DomainDot domain={d} />
      ))}
    </span>
  );
}

function DomainDot({ domain }: { domain: string }) {
  return <i class={`domain-dot ${domain.toLowerCase()}`} aria-hidden="true" />;
}

const plusIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  </svg>
);

const chevron = (
  <svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

const zoomIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
);

const checkIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

/** Symbol des Tabs „Deck“: gestapelte Lagen, damit es sich von den zwei Karten der Sammlung abhebt. */
export const DECK_ICON_PATH = 'M12 3 3 7.5l9 4.5 9-4.5L12 3zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5';

const deckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={DECK_ICON_PATH} />
  </svg>
);
