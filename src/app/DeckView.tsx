import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  battlefieldsOf,
  byCost,
  championsFor,
  checkDeck,
  COLORLESS,
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
  runeCount,
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
type Kind = 'all' | 'unit' | 'spell' | 'gear';
type Sort = 'energy' | 'kind' | 'name' | 'owned';

const KIND_LABEL: Record<CardKind, string> = { legend: 'Legende', unit: 'Einheit', spell: 'Zauber', gear: 'Ausrüstung', rune: 'Rune', battlefield: 'Battlefield' };
const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'unit', label: 'Einheiten' },
  { value: 'spell', label: 'Zauber' },
  { value: 'gear', label: 'Ausrüstung' },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: 'energy', label: 'Energie' },
  { value: 'kind', label: 'Kartenart' },
  { value: 'name', label: 'Name' },
  { value: 'owned', label: 'Aus der Sammlung zuerst' },
];
/** Höchste Stufe im Energie-Filter, zählt als „7+“. */
const MAX_ENERGY = 7;
/** Im Deck wie bei Master Duel nach Art gruppiert: erst Einheiten, dann Zauber, dann Ausrüstung, jeweils nach Kosten. */
const KIND_ORDER: Record<CardKind, number> = { legend: 0, unit: 1, spell: 2, gear: 3, rune: 4, battlefield: 5 };
const byKind = (a: DeckCard, b: DeckCard) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byCost(a, b);
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
        <DeckEditor
          key={deck.deckId}
          initial={deck}
          pool={pool}
          owned={owned}
          priceOf={priceOf}
          urlOf={(card) => catalogs.price(gameId, card.printing.printingId)?.url}
          onSave={onSave}
          onBack={() => setScreen({ kind: 'list' })}
          onChangeChampion={() => setScreen({ kind: 'champion', legend: deck.legend, deckId: deck.deckId })}
          onDelete={() => {
            if (!confirm(`Deck „${deck.name}“ löschen?`)) return;
            onDelete(deck.deckId);
            setScreen({ kind: 'list' });
          }}
        />
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

/** So lange halten, bis eine Karte groß aufgeht. */
const HOLD_MS = 450;
const hold = { timer: 0, fired: false, x: 0, y: 0 };

/**
 * Tippen und Halten auf einer Karte: Tippen legt sie ins Deck oder nimmt sie heraus, Halten (Rechtsklick,
 * Kontextmenü-Taste) zeigt sie groß. Wer beim Halten scrollt, öffnet nichts.
 */
function press(onTap: () => void, onHold: () => void) {
  return {
    onPointerDown: (e: PointerEvent) => {
      clearTimeout(hold.timer);
      hold.fired = false;
      hold.x = e.clientX;
      hold.y = e.clientY;
      if (e.pointerType === 'mouse') return;
      hold.timer = window.setTimeout(() => {
        hold.fired = true;
        navigator.vibrate?.(8);
        onHold();
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (Math.abs(e.clientX - hold.x) + Math.abs(e.clientY - hold.y) > 10) clearTimeout(hold.timer);
    },
    onPointerUp: () => {
      clearTimeout(hold.timer);
      // Nach dem Halten kommt auf manchen Geräten noch ein Klick, auf anderen nicht
      if (hold.fired) setTimeout(() => (hold.fired = false), 400);
    },
    onPointerCancel: () => clearTimeout(hold.timer),
    onClick: () => {
      if (hold.fired) hold.fired = false;
      else onTap();
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      clearTimeout(hold.timer);
      if (!hold.fired) onHold();
    },
  };
}

const thumb = (c: DeckCard) => c.printing.thumbUrl ?? c.printing.imageUrl;

/**
 * Deck bearbeiten wie im Deckbau von Master Duel: das Deck als Kartenraster (oben, im Querformat links),
 * darunter die passenden Karten zum Antippen. Leere Plätze zeigen, wie viel noch fehlt.
 */
function DeckEditor(props: {
  initial: Deck;
  pool: DeckPool;
  owned: Map<string, number>;
  priceOf(card: DeckCard): number | undefined;
  urlOf(card: DeckCard): string | undefined;
  onSave(deck: Deck): void;
  onBack(): void;
  onChangeChampion(): void;
  onDelete(): void;
}) {
  const { initial, pool, owned, priceOf, urlOf, onSave, onBack, onChangeChampion, onDelete } = props;
  const [deck, setDeck] = useState(initial);
  // Schnelle Tipps hintereinander bauen aufeinander auf, nicht auf einem veralteten Stand
  const current = useRef(initial);
  const change = (update: (d: Deck) => Deck) => {
    const next = update(current.current);
    if (next === current.current) return false;
    current.current = next;
    setDeck(next);
    onSave(next);
    return true;
  };
  const [part, setPart] = useState<Part>('cards');
  const [query, setQuery] = useState('');
  const [bfQuery, setBfQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [energy, setEnergy] = useState<number | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('energy');
  const [sheet, setSheet] = useState<'sort' | 'filter' | 'more' | null>(null);
  const [shown, setShown] = useState<DeckCard | null>(null);
  // Zuletzt hineingelegte Kopie: springt ins Deck und wird sichtbar gescrollt
  const [fresh, setFresh] = useState<{ id: string; n: number } | null>(null);
  const [hint, setHint] = useState<{ text: string; at: number } | null>(null);
  const [spoken, setSpoken] = useState('');
  const pane = useRef<HTMLDivElement>(null);
  const hintTimer = useRef(0);

  const legend = pool.cards.get(deck.legend);
  const champion = pool.cards.get(deck.champion);
  const mainCards = useMemo(() => (legend ? mainCardsFor(legend, pool) : []), [legend, pool]);
  const allowed = useMemo(() => new Set(mainCards.map((c) => c.id)), [mainCards]);
  const runes = useMemo(() => (legend ? runesFor(legend, pool) : []), [legend, pool]);
  const battlefields = useMemo(() => battlefieldsOf(pool), [pool]);
  const check = checkDeck(deck, pool);
  const missing = missingCount(deck, owned);
  const value = deckValue(deck, pool, priceOf);
  const ownedOf = (c: DeckCard) => owned.get(c.id) ?? 0;

  /** Kurzer Hinweis unten in der Kartenliste, wenn ein Tipp nichts bewirkt. */
  const warn = (text: string) => {
    clearTimeout(hintTimer.current);
    setHint({ text, at: Date.now() });
    hintTimer.current = window.setTimeout(() => setHint(null), 2800);
  };
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  useEffect(() => {
    const box = pane.current;
    const tile = box?.querySelector<HTMLElement>('.fresh');
    if (!box || !tile) return;
    const b = box.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const dy = t.top < b.top ? t.top - b.top - 12 : t.bottom > b.bottom ? t.bottom - b.bottom + 12 : 0;
    if (dy) box.scrollBy({ top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [fresh]);

  const addCard = (c: DeckCard) => {
    if (!change((d) => withCard(d, c, 1, pool))) {
      warn(
        copiesOf(current.current, c.id) >= DECK_RULES.copies
          ? `${cardTitle(c)} ist schon ${DECK_RULES.copies}× im Deck`
          : `Schon ${DECK_RULES.signatures} Signature-Karten im Deck`,
      );
      return;
    }
    const n = copiesOf(current.current, c.id);
    setFresh({ id: c.id, n: n - 1 });
    setSpoken(`${cardTitle(c)} hinzugefügt, ${n} im Deck`);
  };
  const removeCard = (c: DeckCard) => {
    if (!change((d) => withCard(d, c, -1, pool))) return;
    setFresh(null);
    setSpoken(`${cardTitle(c)} herausgenommen, ${copiesOf(current.current, c.id)} im Deck`);
  };
  const addRune = (r: DeckCard) => {
    const full = runeCount(current.current) >= DECK_RULES.runes;
    if (!change((d) => withRune(d, r, 1, runes))) {
      warn(`Schon ${DECK_RULES.runes} Runen im Deck`);
      return;
    }
    const n = current.current.runes[r.id] ?? 0;
    setFresh({ id: r.id, n: n - 1 });
    // Bei 12 Runen verschiebt ein Tipp die Aufteilung; das soll nicht unbemerkt passieren
    if (full) warn(`Dafür ist eine andere Rune herausgegangen`);
    setSpoken(`${r.name}: ${n} im Deck`);
  };
  const removeRune = (r: DeckCard) => {
    if (!change((d) => withRune(d, r, -1, runes))) return;
    setFresh(null);
    setSpoken(`${r.name}: ${current.current.runes[r.id] ?? 0} im Deck`);
  };
  const toggleField = (b: DeckCard) => {
    const chosen = current.current.battlefields.includes(b.id);
    if (!change((d) => toggleBattlefield(d, b))) {
      warn(`Schon ${DECK_RULES.battlefields} Battlefields. Tippe eins im Deck an, um es herauszunehmen.`);
      return;
    }
    setFresh(chosen ? null : { id: b.id, n: 0 });
    setSpoken(`${b.name} ${chosen ? 'herausgenommen' : 'hinzugefügt'}`);
  };

  // Deck als Raster: Champion zuerst, dann Einheiten, Zauber, Ausrüstung je nach Kosten; jede Kopie einzeln
  const seen = new Map<string, number>();
  const deckTile = (c: DeckCard, label: string, onTap: () => void, extra = '') => {
    const i = seen.get(c.id) ?? 0;
    seen.set(c.id, i + 1);
    const lacking = i >= ownedOf(c);
    const isFresh = fresh?.id === c.id && fresh.n === i;
    return (
      <button
        key={`${c.id}#${i}`}
        class={`tile${extra}${lacking ? ' lacking' : ''}${isFresh ? ' fresh' : ''}`}
        aria-label={`${label}${lacking ? ' (fehlt dir)' : ''}`}
        {...press(onTap, () => setShown(c))}
      >
        <img src={thumb(c)} alt="" loading="lazy" draggable={false} />
        {extra === ' champ' && <b class="tile-champ">{starIcon}</b>}
      </button>
    );
  };
  const slots = (n: number, cls = '') => Array.from({ length: Math.max(0, n) }, (_, i) => <i key={`slot-${i}`} class={`slot${cls}`} aria-hidden="true" />);
  const inDeck = Object.entries(deck.cards)
    .map(([id, n]) => ({ card: pool.cards.get(id), n }))
    .filter((e): e is { card: DeckCard; n: number } => !!e.card)
    .sort((a, b) => byKind(a.card, b.card));
  const runeOrder = (id: string) => {
    const i = runes.findIndex((r) => r.id === id);
    return i < 0 ? runes.length : i;
  };
  const runesIn = Object.entries(deck.runes)
    .map(([id, n]) => ({ card: pool.cards.get(id), n }))
    .filter((e): e is { card: DeckCard; n: number } => !!e.card)
    .sort((a, b) => runeOrder(a.card.id) - runeOrder(b.card.id));
  const fieldsIn = deck.battlefields.map((id) => pool.cards.get(id)).filter((b): b is DeckCard => !!b);
  const broken = check.problems.filter((p) => !p.startsWith('Noch '));

  // Kartenliste: Suche, Filter und Sortierung
  const q = query.trim().toLowerCase();
  const filters = (kind !== 'all' ? 1 : 0) + (energy !== null ? 1 : 0) + (domain ? 1 : 0) + (ownedOnly ? 1 : 0);
  const order: Record<Sort, (a: DeckCard, b: DeckCard) => number> = {
    energy: byCost,
    kind: byKind,
    name: (a, b) => cardTitle(a).localeCompare(cardTitle(b)),
    owned: (a, b) => Number(ownedOf(b) > 0) - Number(ownedOf(a) > 0) || byCost(a, b),
  };
  const listed = mainCards
    .filter(
      (c) =>
        (kind === 'all' || c.kind === kind) &&
        (energy === null || (energy === MAX_ENERGY ? (c.energy ?? -1) >= MAX_ENERGY : c.energy === energy)) &&
        (!domain || (domain === COLORLESS ? c.domains.every((d) => d === COLORLESS) : c.domains.includes(domain))) &&
        (!ownedOnly || ownedOf(c) > 0) &&
        (!q || `${cardTitle(c)} ${c.tags.join(' ')}`.toLowerCase().includes(q)),
    )
    .sort(order[sort]);
  const bq = bfQuery.trim().toLowerCase();
  const listedFields = battlefields.filter((b) => !bq || b.name.toLowerCase().includes(bq));

  const listTile = (c: DeckCard, count: number, blocked: boolean, onTap: () => void, landscape = false) => {
    const own = ownedOf(c);
    const name = c.kind === 'unit' || c.kind === 'spell' || c.kind === 'gear' ? cardTitle(c) : c.name;
    return (
      <button
        key={c.id}
        class={`tile${landscape ? ' landscape' : ''}${count ? ' in' : ''}${blocked ? ' blocked' : ''}`}
        aria-label={`${name}, ${count} im Deck, ${own} in Sammlung`}
        aria-disabled={blocked || undefined}
        {...press(onTap, () => setShown(c))}
      >
        <img src={thumb(c)} alt="" loading="lazy" draggable={false} />
        {count > 0 && (
          <b key={count} class={`tile-count${fresh?.id === c.id ? ' pop' : ''}`}>
            {landscape ? checkIcon : count}
          </b>
        )}
        {own > 0 && (
          <span class="tile-own">
            {ownIcon}
            {own}
          </span>
        )}
      </button>
    );
  };

  /** Im großen Kartenblatt: genaue Anzahl ändern, Champion wechseln, Battlefield wählen. */
  const controls = (c: DeckCard) => {
    if (c.kind === 'battlefield') {
      const chosen = deck.battlefields.includes(c.id);
      return (
        <button class={chosen ? '' : 'primary'} disabled={!chosen && deck.battlefields.length >= DECK_RULES.battlefields} onClick={() => toggleField(c)}>
          {chosen ? 'Aus dem Deck nehmen' : 'Ins Deck legen'}
        </button>
      );
    }
    const isRune = c.kind === 'rune' && runes.some((r) => r.id === c.id);
    if (!isRune && !allowed.has(c.id)) return null;
    const n = isRune ? deck.runes[c.id] ?? 0 : copiesOf(deck, c.id);
    return (
      <>
        <div class="sheet-qty">
          <span>Im Deck</span>
          <div class="qty">
            <button onClick={() => (isRune ? removeRune(c) : removeCard(c))} disabled={isRune ? !n : !deck.cards[c.id]} aria-label="Eine weniger">
              −
            </button>
            <span aria-live="polite">{n}</span>
            <button onClick={() => (isRune ? addRune(c) : addCard(c))} disabled={!isRune && room(deck, c, pool) === 0} aria-label="Eine mehr">
              +
            </button>
          </div>
        </div>
        {c.id === deck.champion && (
          <button
            onClick={() => {
              setShown(null);
              onChangeChampion();
            }}
          >
            Champion wechseln
          </button>
        )}
      </>
    );
  };

  return (
    <section class="decks deck-edit">
      <header class="builder-head">
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
        <button class="tool" aria-label="Weitere Aktionen" aria-haspopup="dialog" onClick={() => setSheet('more')}>
          {moreIcon}
        </button>
      </header>

      <div class="builder">
        <div class="deck-pane" ref={pane}>
          <div class="deck-top">
            {legend && (
              <button class="deck-legend" onClick={() => setShown(legend)}>
                <img src={thumb(legend)} alt="" />
                <span>
                  <small>
                    <Domains domains={legend.domains} />
                    Legende
                  </small>
                  <strong>
                    {legendTitle(legend)} · {legend.name}
                  </strong>
                </span>
              </button>
            )}
            <span class="deck-meta">
              {check.complete && <em class="tag ok">Vollständig</em>}
              {value !== undefined && <strong>{formatEur(value)}</strong>}
              {missing > 0 && <small>{missing} fehlen dir</small>}
            </span>
          </div>
          {broken.length > 0 && <p class="deck-problems">{broken.slice(0, 2).join(' · ')}</p>}

          <h2 class="pane-head">
            Hauptdeck
            <b class={check.main >= DECK_RULES.main ? 'done' : ''}>
              {check.main}/{DECK_RULES.main}
            </b>
            {check.signatures > 0 && (
              <small>
                Signature {check.signatures}/{DECK_RULES.signatures}
              </small>
            )}
          </h2>
          <div class="deck-grid">
            {champion && deckTile(champion, `${cardTitle(champion)}, Champion`, () => setShown(champion), ' champ')}
            {inDeck.flatMap(({ card, n }) => Array.from({ length: n }, () => deckTile(card, `${cardTitle(card)} herausnehmen`, () => removeCard(card))))}
            {slots(DECK_RULES.main - check.main)}
          </div>

          <h2 class="pane-head">
            Runen
            <b class={check.runes === DECK_RULES.runes ? 'done' : ''}>
              {check.runes}/{DECK_RULES.runes}
            </b>
          </h2>
          <div class="deck-grid runes">
            {runesIn.flatMap(({ card, n }) => Array.from({ length: n }, () => deckTile(card, `${card.name} herausnehmen`, () => removeRune(card))))}
            {slots(DECK_RULES.runes - check.runes)}
          </div>

          <h2 class="pane-head">
            Battlefields
            <b class={check.battlefields === DECK_RULES.battlefields ? 'done' : ''}>
              {check.battlefields}/{DECK_RULES.battlefields}
            </b>
          </h2>
          <div class="deck-grid fields">
            {fieldsIn.map((b) => deckTile(b, `${b.name} herausnehmen`, () => toggleField(b), ' landscape'))}
            {slots(DECK_RULES.battlefields - fieldsIn.length, ' landscape')}
          </div>
          <p class="pane-hint">Antippen legt eine Karte hinein oder nimmt sie heraus. Halten zeigt sie groß.</p>
        </div>

        <div class="list-pane">
          <div class="segmented deck-parts" role="radiogroup" aria-label="Karten zum Hinzufügen">
            {(
              [
                ['cards', 'Karten', check.main, DECK_RULES.main],
                ['runes', 'Runen', check.runes, DECK_RULES.runes],
                ['battlefields', 'Battlefields', check.battlefields, DECK_RULES.battlefields],
              ] as const
            ).map(([v, label, n, of]) => (
              <button role="radio" aria-checked={part === v} class={part === v ? 'active' : ''} onClick={() => setPart(v)}>
                <span>{label}</span>
                <small class={n >= of ? 'done' : ''}>
                  {n}/{of}
                </small>
              </button>
            ))}
          </div>

          {part === 'cards' && (
            <>
              <div class="list-tools">
                <input type="search" enterkeyhint="search" placeholder="Karte suchen" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
                <button class="tool" aria-label={`Sortieren: ${SORTS.find((s) => s.value === sort)?.label}`} aria-haspopup="dialog" onClick={() => setSheet('sort')}>
                  {sortIcon}
                </button>
                <button
                  class={`tool${filters ? ' set' : ''}`}
                  aria-label={filters ? `Filter, ${filters} aktiv` : 'Filter'}
                  aria-haspopup="dialog"
                  onClick={() => setSheet('filter')}
                >
                  {filterIcon}
                  {filters > 0 && <b class="tool-badge">{filters}</b>}
                </button>
              </div>
              {listed.length ? (
                <div class="list-grid">{listed.map((c) => listTile(c, copiesOf(deck, c.id), room(deck, c, pool) === 0, () => addCard(c)))}</div>
              ) : (
                <p class="muted none">Keine Karte</p>
              )}
            </>
          )}

          {part === 'runes' && (
            <>
              {check.runes === 0 && runes.length > 1 && (
                <button class="even-runes" onClick={() => change((d) => evenRunes(d, runes))}>
                  Je {DECK_RULES.runes / runes.length} verteilen
                </button>
              )}
              <div class="list-grid">{runes.map((r) => listTile(r, deck.runes[r.id] ?? 0, false, () => addRune(r)))}</div>
            </>
          )}

          {part === 'battlefields' && (
            <>
              <div class="list-tools">
                <input type="search" enterkeyhint="search" placeholder="Battlefield suchen" value={bfQuery} onInput={(e) => setBfQuery(e.currentTarget.value)} />
              </div>
              {listedFields.length ? (
                <div class="list-grid landscape">
                  {listedFields.map((b) => {
                    const chosen = deck.battlefields.includes(b.id);
                    return listTile(b, chosen ? 1 : 0, !chosen && deck.battlefields.length >= DECK_RULES.battlefields, () => toggleField(b), true);
                  })}
                </div>
              ) : (
                <p class="muted none">Kein Battlefield</p>
              )}
            </>
          )}
          {hint && (
            <p class="builder-hint" key={hint.at}>
              {hint.text}
            </p>
          )}
        </div>
      </div>
      <p class="sr-only" role="status">
        {hint?.text ?? spoken}
      </p>

      {shown && (
        <CardSheet card={shown} owned={ownedOf(shown)} price={priceOf(shown)} url={urlOf(shown)} onClose={() => setShown(null)}>
          {controls(shown)}
        </CardSheet>
      )}
      {sheet === 'sort' && (
        <Sheet label="Sortieren" onClose={() => setSheet(null)}>
          <h2>Sortieren</h2>
          <div class="options" role="radiogroup" aria-label="Sortieren nach">
            {SORTS.map((o) => (
              <button
                role="radio"
                aria-checked={sort === o.value}
                class={sort === o.value ? 'active' : ''}
                onClick={() => {
                  setSort(o.value);
                  setSheet(null);
                }}
              >
                {o.label}
                {sort === o.value && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'filter' && legend && (
        <Sheet label="Filter" onClose={() => setSheet(null)}>
          <h2>Filter</h2>
          <div class="field">
            <span>Kartenart</span>
            <div class="chips" role="radiogroup" aria-label="Kartenart">
              {KINDS.map((k) => (
                <button role="radio" aria-checked={kind === k.value} class={kind === k.value ? 'active' : ''} onClick={() => setKind(k.value)}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span>Energie</span>
            <div class="chips energy" role="radiogroup" aria-label="Energie">
              <button role="radio" aria-checked={energy === null} class={energy === null ? 'active' : ''} onClick={() => setEnergy(null)}>
                Alle
              </button>
              {Array.from({ length: MAX_ENERGY + 1 }, (_, e) => (
                <button role="radio" aria-checked={energy === e} class={energy === e ? 'active' : ''} onClick={() => setEnergy(energy === e ? null : e)}>
                  {e === MAX_ENERGY ? `${e}+` : e}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span>Domain</span>
            <div class="chips" role="radiogroup" aria-label="Domain">
              <button role="radio" aria-checked={!domain} class={!domain ? 'active' : ''} onClick={() => setDomain(null)}>
                Alle
              </button>
              {[...legend.domains, COLORLESS].map((d) => (
                <button role="radio" aria-checked={domain === d} class={domain === d ? 'active' : ''} onClick={() => setDomain(domain === d ? null : d)}>
                  {d !== COLORLESS && <DomainDot domain={d} />}
                  {d === COLORLESS ? 'Farblos' : d}
                </button>
              ))}
            </div>
          </div>
          <label class="check">
            <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.currentTarget.checked)} />
            Nur Karten aus meiner Sammlung
          </label>
          {filters > 0 && (
            <button
              class="reset-filters"
              onClick={() => {
                setKind('all');
                setEnergy(null);
                setDomain(null);
                setOwnedOnly(false);
              }}
            >
              Filter zurücksetzen
            </button>
          )}
        </Sheet>
      )}
      {sheet === 'more' && (
        <Sheet label="Deck" onClose={() => setSheet(null)}>
          <h2>{deck.name}</h2>
          <div class="options">
            <button
              onClick={() => {
                setSheet(null);
                onChangeChampion();
              }}
            >
              Champion wechseln
            </button>
            <button
              class="danger"
              onClick={() => {
                setSheet(null);
                onDelete();
              }}
            >
              Deck löschen
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function CardSheet(props: { card: DeckCard; owned: number; price?: number; url?: string; onClose(): void; children?: ComponentChildren }) {
  const { card, owned, price, url, onClose, children } = props;
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
      {children}
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

const starIcon = (
  <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
    <path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" fill="currentColor" />
  </svg>
);

/** Kleines Symbol des Tabs „Sammlung“ vor der Anzahl eigener Karten. */
const ownIcon = (
  <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
    <path d="M8 4h10a2 2 0 0 1 2 2v12M6 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" />
  </svg>
);

const sortIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

const filterIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
);

const moreIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M6 12h.01M12 12h.01M18 12h.01" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />
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
