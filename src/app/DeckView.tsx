import type { ComponentChildren } from 'preact';
import { useBack } from './back';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  battlefieldsOf,
  byCost,
  byCostThenDomain,
  byPowerThenDomain,
  championsFor,
  checkDeck,
  COLORLESS,
  copiesOf,
  costByDomain,
  deckEntries,
  DECK_GAMES,
  DECK_RULES,
  deckPool,
  deckValue,
  evenRunes,
  mainCardsFor,
  missingCount,
  newDeck,
  ownedByCard,
  allCopiesOf,
  room,
  runeCount,
  runesFor,
  sideCopiesOf,
  sideRoom,
  toggleBattlefield,
  withCard,
  withChampion,
  withRune,
  withSideCard,
  type CardKind,
  type Deck,
  type DeckCard,
  type DeckPool,
} from '../core/deck';
import { newId } from '../core/collection';
import { buildFromMeta, loadMeta, metaBanned, metaChampion, metaCounts, metaStats, playRate, type MetaFile, type MetaStats } from '../core/meta';
import { banLabel, bannedNames, BUILTIN_BANLISTS, loadBanlist, newerBanlist, type BanlistFile } from '../core/banlist';
import { formatEur, priceFor } from '../core/prices';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { Sheet } from './Sheet';
import { WishToggle } from './TradeView';
import { cardSrcSet, printingCode } from './format';
import { MetaSheet, sparkIcon } from './MetaSheet';
import { useWishlist, wishlist, type WishlistState } from './wishlist';

interface Props {
  catalogs: Catalogs;
  items: CollectionItem[];
  decks: Deck[];
  gameId: string;
  onSave(deck: Deck): void;
  onDelete(deckId: string): void;
}

type Screen = { kind: 'list' } | { kind: 'legend'; auto?: boolean } | { kind: 'champion'; legend: string; deckId?: string } | { kind: 'edit'; deckId: string };
type Part = 'cards' | 'side' | 'runes' | 'battlefields';
type Kind = 'all' | 'unit' | 'spell' | 'gear';
type Sort = 'energy' | 'power' | 'kind' | 'name' | 'owned';

const KIND_LABEL: Record<CardKind, string> = { legend: 'Legende', unit: 'Einheit', spell: 'Zauber', gear: 'Ausrüstung', rune: 'Rune', battlefield: 'Battlefield' };
const KINDS: { value: Kind; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'unit', label: 'Einheiten' },
  { value: 'spell', label: 'Zauber' },
  { value: 'gear', label: 'Ausrüstung' },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: 'energy', label: 'Energie, dann Domain' },
  { value: 'power', label: 'Power, dann Domain' },
  { value: 'kind', label: 'Kartenart' },
  { value: 'name', label: 'Name' },
  { value: 'owned', label: 'Aus der Sammlung zuerst' },
];
/** Höchste Stufe im Energie-Filter, zählt als „7+“. */
const MAX_ENERGY = 7;
/** Im Deck wie bei Master Duel nach Art gruppiert: erst Einheiten, dann Zauber, dann Ausrüstung, jeweils nach Kosten. */
const KIND_ORDER: Record<CardKind, number> = { legend: 0, unit: 1, spell: 2, gear: 3, rune: 4, battlefield: 5 };
/** Reihenfolge der Domains wie auf dem Farbrad des Spiels. */
const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];

/** Name im Deck: Champions mit Titel, Legenden mit ihrem Champion. */
const cardTitle = (c: DeckCard) => c.id;
const legendTitle = (c: DeckCard) => c.championOf ?? c.name;

export function DeckView({ catalogs, items, decks, gameId, onSave, onDelete }: Props) {
  // Banlist: eingebaut, aktualisiert durch die vom täglichen Build (falls neuer)
  const [banlist, setBanlist] = useState<BanlistFile | null>(BUILTIN_BANLISTS[gameId] ?? null);
  useEffect(() => {
    let alive = true;
    setBanlist(BUILTIN_BANLISTS[gameId] ?? null);
    loadBanlist(import.meta.env.BASE_URL, gameId).then((b) => alive && b && setBanlist(newerBanlist(b, BUILTIN_BANLISTS[gameId])));
    return () => {
      alive = false;
    };
  }, [gameId]);
  const bans = useMemo(() => bannedNames(banlist), [banlist]);
  const pool = useMemo(
    () => (DECK_GAMES.includes(gameId) ? deckPool(gameId, catalogs.ordered.get(gameId) ?? [], catalogs.sets.get(gameId) ?? [], bans) : null),
    [catalogs, gameId, bans],
  );
  const owned = useMemo(() => (pool ? ownedByCard(items, pool) : new Map<string, number>()), [items, pool]);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [shown, setShown] = useState<DeckCard | null>(null);
  // Turnierlisten für Deckvorschläge; fehlen sie, geht alles andere wie gehabt
  const [meta, setMeta] = useState<MetaFile | null>(null);
  useEffect(() => {
    let alive = true;
    loadMeta(import.meta.env.BASE_URL, gameId).then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, [gameId]);
  const counts = useMemo(() => (pool ? metaCounts(meta, pool) : new Map<string, number>()), [meta, pool]);
  const wish = useWishlist();
  // Hinweis im Deck nach dem automatischen Bauen
  const [notice, setNotice] = useState<string | null>(null);

  if (!pool) {
    return (
      <section class="decks">
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
  const sheet = shown && (
    <CardSheet card={shown} owned={owned.get(shown.id) ?? 0} price={priceOf(shown)} url={catalogs.price(gameId, shown.printing.printingId)?.url} onClose={() => setShown(null)}>
      <WishToggle gameId={gameId} printingId={shown.printing.printingId} wish={wish} />
    </CardSheet>
  );

  if (screen.kind === 'legend') {
    return (
      <>
        <LegendPicker
          pool={pool}
          counts={counts}
          auto={screen.auto}
          onBack={() => setScreen({ kind: 'list' })}
          onPick={(legend) => {
            if (!screen.auto) {
              setScreen({ kind: 'champion', legend: legend.id });
              return;
            }
            // KI-Deck: Champion und Karten kommen aus den Turnierlisten
            const stats = metaStats(meta, legend, pool);
            const champions = championsFor(legend, pool);
            const champion = (stats && metaChampion(stats, champions)) ?? champions[0];
            if (!stats || !champion) {
              setScreen({ kind: 'champion', legend: legend.id });
              return;
            }
            const created = buildFromMeta(newDeck(gameId, legend, champion, newId(), new Date().toISOString()), stats, pool, { owned });
            onSave(created);
            setNotice(builtNotice(stats, pool));
            setScreen({ kind: 'edit', deckId: created.deckId });
          }}
          onShow={setShown}
        />
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
          stats={metaStats(meta, legend, pool)}
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
          meta={meta}
          banlist={banlist}
          notice={notice}
          priceOf={priceOf}
          wish={wish}
          urlOf={(card) => catalogs.price(gameId, card.printing.printingId)?.url}
          onSave={onSave}
          onBack={() => {
            setNotice(null);
            setScreen({ kind: 'list' });
          }}
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
      {pool.legends.length > 0 && !pool.legends.some((l) => l.championOf) && <p class="banner">Kartendaten werden aktualisiert. Bitte die App gleich neu öffnen.</p>}
      {counts.size > 0 && (
        <button class="ai-deck" onClick={() => setScreen({ kind: 'legend', auto: true })}>
          <span class="ai-deck-icon">{sparkIcon}</span>
          <span class="ai-deck-text">
            <strong>KI-Deck bauen</strong>
          </span>
          <i aria-hidden="true">›</i>
        </button>
      )}
      {decks.length > 0 ? (
        <ul class="deck-boxes">
          <li>
            <button class="deck-box new" onClick={() => setScreen({ kind: 'legend' })}>
              <span class="case">{plusIcon}</span>
              <strong>Neues Deck</strong>
            </button>
          </li>
          {decks.map((deck) => (
            <DeckBox key={deck.deckId} deck={deck} pool={pool} owned={owned} priceOf={priceOf} onOpen={() => setScreen({ kind: 'edit', deckId: deck.deckId })} />
          ))}
        </ul>
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

/**
 * Gespeichertes Deck als Kachel wie die Deckboxen in Master Duel: der Champion als Titelkarte vor einem kleinen
 * Kartenstapel, darunter Name, Kartenzahl und Wert. Ein Haken heißt spielbereit.
 */
function DeckBox({ deck, pool, owned, priceOf, onOpen }: { deck: Deck; pool: DeckPool; owned: Map<string, number>; priceOf(card: DeckCard): number | undefined; onOpen(): void }) {
  const legend = pool.cards.get(deck.legend);
  const cover = pool.cards.get(deck.champion) ?? legend;
  const check = checkDeck(deck, pool);
  const value = deckValue(deck, pool, priceOf);
  const missing = missingCount(deck, owned);
  const status = check.complete ? 'Vollständig' : check.problems[0];
  return (
    <li>
      <button class="deck-box" onClick={onOpen} aria-label={`${deck.name}, ${check.main} von ${DECK_RULES.main} Karten, ${status}`}>
        <span class="case">
          {cover && (
            <img
              src={cover.printing.imageUrl}
              srcset={cardSrcSet(cover.printing.imageUrl, [240, 360, 480])}
              sizes="(min-width: 720px) 150px, 31vw"
              alt=""
              loading="lazy"
            />
          )}
          {check.complete ? (
            <i class="state ok" aria-hidden="true">
              {checkIcon}
            </i>
          ) : (
            <i class="state warn" aria-hidden="true">
              !
            </i>
          )}
          {legend && <Domains domains={legend.domains} />}
        </span>
        <strong>{deck.name}</strong>
        <small>
          <span class={check.main < DECK_RULES.main ? 'deck-count short' : 'deck-count'}>
            {check.main}/{DECK_RULES.main}
          </span>
          {value !== undefined && <span>{formatEur(value)}</span>}
        </small>
        {missing > 0 && <small class="missing">{missing} fehlen dir</small>}
      </button>
    </li>
  );
}

function LegendPicker(props: { pool: DeckPool; counts: Map<string, number>; auto?: boolean; onBack(): void; onPick(legend: DeckCard): void; onShow(card: DeckCard): void }) {
  const { pool, counts, auto, onBack, onPick, onShow } = props;
  useBack(true, onBack);
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const legends = pool.legends.filter(
    (l) => (!domain || l.domains.includes(domain)) && (!q || `${l.championOf} ${l.name}`.toLowerCase().includes(q)),
  );
  // Fürs KI-Deck: die meistgespielten Legenden zuerst
  if (auto) legends.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || (a.championOf ?? a.name).localeCompare(b.championOf ?? b.name));
  return (
    <section class="decks">
      <header class="friend-head">
        <button class="link back" onClick={onBack}>
          ‹ Decks
        </button>
        <h1>{auto ? 'KI-Deck bauen' : 'Legende wählen'}</h1>
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
            <PickCard
              key={l.id}
              card={l}
              title={legendTitle(l)}
              detail={l.name}
              badge={counts.get(l.id) ? { text: String(counts.get(l.id)), label: `${counts.get(l.id)} Turnierlisten` } : undefined}
              onPick={() => onPick(l)}
              onShow={() => onShow(l)}
            />
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
  stats: MetaStats | null;
  current?: string;
  backLabel: string;
  onBack(): void;
  onPick(champion: DeckCard): void;
  onShow(card: DeckCard): void;
}) {
  const { legend, pool, stats, current, backLabel, onBack, onPick, onShow } = props;
  useBack(true, onBack);
  const champions = championsFor(legend, pool);
  // Gesperrte Champions bietet die Auswahl nicht an; ein Satz sagt, wo sie geblieben sind
  const bannedChampions = [...pool.cards.values()].filter((c) => c.champion && c.banned && c.championOf === legend.championOf);
  // Champion, den die Turnierlisten am häufigsten spielen
  const favourite = stats && metaChampion(stats, champions);
  const favouriteRate = favourite && stats ? stats.champions.get(favourite.id) ?? 0 : 0;
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
              badge={c === favourite && favouriteRate > 0 ? { text: 'Meta', label: `In ${Math.round(favouriteRate * 100)} % der Turnierlisten` } : undefined}
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
      {bannedChampions.length > 0 && (
        <p class="meta-note center">
          {bannedChampions.map((c) => `${c.id} (${banLabel(c.banned!).toLowerCase()})`).join(', ')} {bannedChampions.length === 1 ? 'steht' : 'stehen'} auf der Banlist.
        </p>
      )}
    </section>
  );
}

/** Karte zum Auswählen: Tipp wählt, die Lupe zeigt die Karte groß. */
function PickCard(props: {
  card: DeckCard;
  title: string;
  detail: string;
  active?: boolean;
  /** Kleines Schild oben links, z. B. wie viele Turnierlisten es zur Legende gibt. */
  badge?: { text: string; label: string };
  onPick(): void;
  onShow(): void;
}) {
  const { card, title, detail, active, badge, onPick, onShow } = props;
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
        {badge && (
          <span class="pick-badge" title={badge.label} aria-label={badge.label}>
            {trophyMini}
            {badge.text}
          </span>
        )}
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
 * Tippen und Halten auf einer Karte der Liste: Tippen legt sie ins Deck, Halten (Rechtsklick,
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

/** Bereich im Deck, aus dem eine Karte kommt. */
type Area = 'main' | 'side' | 'runes' | 'fields';

/** Auf dem Handy erst kurz halten, dann ziehen; wer gleich wischt, scrollt. Mit der Maus geht es sofort los. */
const LIFT_MS = 220;
const SLOP = 8;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface DragOut {
  onTap(): void;
  /** Losgelassen außerhalb des Decks. Fehlt es, lässt sich die Karte nicht ziehen (Champion). */
  onDrop?(): void;
  /** Das Deck: Wer die Karte hier hinauszieht und loslässt, nimmt sie heraus. */
  zone(): HTMLElement | null;
}

const drag = {
  id: -1,
  timer: 0,
  x: 0,
  y: 0,
  mouse: false,
  active: false,
  out: false,
  /** Nach dem Ziehen kommt noch ein Klick; der soll kein Kartenblatt öffnen. */
  swallow: false,
  tile: null as HTMLElement | null,
  ghost: null as HTMLElement | null,
  size: { w: 0, h: 0 },
  opts: null as DragOut | null,
};

function placeGhost(x: number, y: number) {
  const g = drag.ghost;
  if (!g) return;
  // Über dem Finger, damit er die Karte nicht verdeckt
  const { w, h } = drag.size;
  // Am Rand bleibt die Karte ganz sichtbar
  const left = Math.min(Math.max(x - w / 2, 6), innerWidth - w - 6);
  const top = Math.max(y - h - 18, 30);
  g.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(-4deg)`;
}

function lift() {
  const { tile, opts } = drag;
  if (!tile || !opts) return;
  drag.active = true;
  drag.swallow = true;
  navigator.vibrate?.(8);
  const r = tile.getBoundingClientRect();
  const w = Math.min(104, Math.max(72, r.width * 1.6));
  drag.size = { w, h: (w * r.height) / r.width };
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.setAttribute('aria-hidden', 'true');
  g.style.width = `${w}px`;
  g.style.height = `${drag.size.h}px`;
  const img = tile.querySelector('img');
  if (img) g.append(img.cloneNode());
  const bin = document.createElement('b');
  bin.className = 'drag-ghost-out';
  bin.textContent = 'Entfernen';
  g.append(bin);
  // Startet genau auf der Kachel und fliegt dann unter den Finger
  g.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(${r.width / w})`;
  g.style.transformOrigin = '0 0';
  document.body.append(g);
  drag.ghost = g;
  tile.classList.add('lifted');
  opts.zone()?.classList.add('dragging');
  requestAnimationFrame(() => {
    if (drag.ghost !== g) return;
    g.style.transformOrigin = '';
    if (!calm()) g.classList.add('lifting');
    placeGhost(drag.x, drag.y);
    setTimeout(() => g.classList.remove('lifting'), 140);
  });
}

function onDragMove(e: PointerEvent) {
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dx) + Math.abs(dy) <= SLOP) return;
    // Mit der Maus beginnt das Ziehen; auf dem Handy war es ein Wisch zum Scrollen
    if (drag.mouse && drag.opts?.onDrop) lift();
    else return endDrag(false);
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
  placeGhost(drag.x, drag.y);
  const zone = drag.opts?.zone()?.getBoundingClientRect();
  const out = !!zone && (drag.x < zone.left || drag.x > zone.right || drag.y < zone.top || drag.y > zone.bottom);
  if (out !== drag.out) {
    drag.out = out;
    drag.ghost?.classList.toggle('out', out);
    drag.opts?.zone()?.classList.toggle('drop-out', out);
    if (out) navigator.vibrate?.(6);
  }
}

function onDragUp(e: PointerEvent) {
  if (e.pointerId === drag.id) endDrag(e.type === 'pointerup');
}

/** Auf dem Handy darf die Seite nicht mitscrollen, während eine Karte am Finger hängt. */
function holdScroll(e: TouchEvent) {
  if (drag.active) e.preventDefault();
}

function endDrag(drop: boolean) {
  clearTimeout(drag.timer);
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragUp);
  window.removeEventListener('pointercancel', onDragUp);
  const { tile, ghost, opts, active, out } = drag;
  drag.id = -1;
  drag.active = false;
  drag.out = false;
  drag.tile = null;
  drag.ghost = null;
  drag.opts = null;
  if (!active) return;
  setTimeout(() => (drag.swallow = false), 400);
  const zone = opts?.zone();
  zone?.classList.remove('dragging', 'drop-out');
  const remove = drop && out && !!opts?.onDrop;
  const done = () => {
    ghost?.remove();
    tile?.classList.remove('lifted');
  };
  if (!ghost || calm()) done();
  else if (remove) {
    ghost.classList.add('gone');
    setTimeout(done, 200);
  } else if (tile?.isConnected) {
    // Zurück an ihren Platz im Deck
    const r = tile.getBoundingClientRect();
    ghost.classList.add('back');
    ghost.style.transformOrigin = '0 0';
    ghost.style.transform = `translate3d(${r.left}px, ${r.top}px, 0) scale(${r.width / drag.size.w})`;
    setTimeout(done, 200);
  } else done();
  if (remove) opts!.onDrop!();
}

/**
 * Karten im Deck: Antippen zeigt sie groß (mit Entfernen und weiterer Kopie), herausziehen nimmt sie heraus.
 * Auf dem Handy hebt kurzes Halten die Karte an, ein schneller Wisch scrollt wie gewohnt.
 */
function dragOut(opts: DragOut) {
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button > 0 || drag.id !== -1) return;
      drag.id = e.pointerId;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.mouse = e.pointerType === 'mouse';
      drag.tile = e.currentTarget as HTMLElement;
      drag.opts = opts;
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragUp);
      window.addEventListener('pointercancel', onDragUp);
      if (!drag.mouse && opts.onDrop) drag.timer = window.setTimeout(lift, LIFT_MS);
    },
    onClick: () => {
      if (drag.swallow) drag.swallow = false;
      else opts.onTap();
    },
    onContextMenu: (e: MouseEvent) => {
      // Langes Drücken auf Android öffnet sonst ein Menü mitten im Ziehen
      e.preventDefault();
      if (!drag.active && !drag.swallow) opts.onTap();
    },
  };
}

/**
 * Deck bearbeiten wie im Deckbau von Master Duel: das Deck als Kartenraster (oben, im Querformat links),
 * darunter die passenden Karten zum Antippen. Leere Plätze zeigen, wie viel noch fehlt.
 */
function DeckEditor(props: {
  initial: Deck;
  pool: DeckPool;
  owned: Map<string, number>;
  meta: MetaFile | null;
  banlist: BanlistFile | null;
  /** Kurzer Hinweis beim Öffnen, z. B. nach dem automatischen Bauen. */
  notice?: string | null;
  priceOf(card: DeckCard): number | undefined;
  urlOf(card: DeckCard): string | undefined;
  wish: WishlistState;
  onSave(deck: Deck): void;
  onBack(): void;
  onChangeChampion(): void;
  onDelete(): void;
}) {
  const { initial, pool, owned, meta, banlist, notice, priceOf, urlOf, wish, onSave, onBack, onChangeChampion, onDelete } = props;
  useBack(true, onBack);
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
  const [sheet, setSheet] = useState<'sort' | 'filter' | 'more' | 'meta' | null>(null);
  /** Groß gezeigte Karte; `from`, wenn sie im Deck angetippt wurde. */
  const [shown, setShownState] = useState<{ card: DeckCard; from?: Area } | null>(null);
  const setShown = (card: DeckCard | null, from?: Area) => setShownState(card ? { card, from } : null);
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
  const stats = useMemo(() => (legend ? metaStats(meta, legend, pool) : null), [meta, legend, pool]);
  const missing = missingCount(deck, owned);
  const value = deckValue(deck, pool, priceOf);
  const ownedOf = (c: DeckCard) => owned.get(c.id) ?? 0;
  const power = costByDomain(deck, pool).reduce((n, c) => n + c.power, 0);
  const domainOrder = legend?.domains ?? [];
  const byKindDomain = (a: DeckCard, b: DeckCard) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byCostThenDomain(domainOrder)(a, b);
  /** Karten, die man nicht (oft genug) besitzt und noch nicht auf der Wunschliste hat. */
  const wishable = deckEntries(deck)
    .map((e) => ({ card: pool.cards.get(e.id), lacking: e.count - (owned.get(e.id) ?? 0) }))
    .filter((e): e is { card: DeckCard; lacking: number } => !!e.card && e.lacking > 0 && !wish.keys.has(`${pool.gameId}|${e.card.printing.printingId}`));

  /** Kurzer Hinweis unten in der Kartenliste, wenn ein Tipp nichts bewirkt. */
  const warn = (text: string, ms = 2800) => {
    clearTimeout(hintTimer.current);
    setHint({ text, at: Date.now() });
    hintTimer.current = window.setTimeout(() => setHint(null), ms);
  };
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  useEffect(() => {
    // Fest am Deck, damit das Handy weiß, dass hier gezogen werden kann (sonst scrollt es trotzdem mit)
    const box = pane.current;
    box?.addEventListener('touchmove', holdScroll, { passive: false });
    return () => {
      box?.removeEventListener('touchmove', holdScroll);
      if (drag.opts) endDrag(false);
    };
  }, []);
  useEffect(() => {
    if (notice) warn(notice, 5000);
  }, [notice]);

  useEffect(() => {
    const box = pane.current;
    const tile = box?.querySelector<HTMLElement>('.fresh');
    if (!box || !tile) return;
    const b = box.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const dy = t.top < b.top ? t.top - b.top - 12 : t.bottom > b.bottom ? t.bottom - b.bottom + 12 : 0;
    if (dy) box.scrollBy({ top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [fresh]);

  /** Warum keine weitere Kopie mehr hineinpasst. */
  const fullText = (c: DeckCard, area: Area, d = current.current) =>
    area === 'runes'
      ? `Schon ${DECK_RULES.runes} Runen im Deck`
      : allCopiesOf(d, c.id) >= DECK_RULES.copies
        ? sideCopiesOf(d, c.id)
          ? `${cardTitle(c)} ist schon ${DECK_RULES.copies}× in Deck und Side Deck`
          : `${cardTitle(c)} ist schon ${DECK_RULES.copies}× im Deck`
        : area === 'side'
          ? `Side Deck ist voll (${DECK_RULES.side} Karten)`
          : `Schon ${DECK_RULES.signatures} Signature-Karten im Deck`;

  /** Hinweis, wenn eine gesperrte Karte ins Deck soll. */
  const bannedWarn = (c: DeckCard) => c.banned && (warn(`${c.kind === 'battlefield' ? c.name : cardTitle(c)} steht auf der Banlist (${banLabel(c.banned).toLowerCase()})`), true);
  const addCard = (c: DeckCard) => {
    if (bannedWarn(c)) return;
    if (!change((d) => withCard(d, c, 1, pool))) {
      warn(fullText(c, 'main'));
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
  const addSide = (c: DeckCard) => {
    if (bannedWarn(c)) return;
    if (!change((d) => withSideCard(d, c, 1))) {
      warn(fullText(c, 'side'));
      return;
    }
    const n = sideCopiesOf(current.current, c.id);
    setFresh({ id: `side:${c.id}`, n: n - 1 });
    setSpoken(`${cardTitle(c)} ins Side Deck, ${n} im Side Deck`);
  };
  const removeSide = (c: DeckCard) => {
    if (!change((d) => withSideCard(d, c, -1))) return;
    setFresh(null);
    setSpoken(`${cardTitle(c)} aus dem Side Deck, ${sideCopiesOf(current.current, c.id)} im Side Deck`);
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
    if (!chosen && bannedWarn(b)) return;
    if (!change((d) => toggleBattlefield(d, b))) {
      warn(`Schon ${DECK_RULES.battlefields} Battlefields. Zieh eins aus dem Deck, um es herauszunehmen.`);
      return;
    }
    setFresh(chosen ? null : { id: b.id, n: 0 });
    setSpoken(`${b.name} ${chosen ? 'herausgenommen' : 'hinzugefügt'}`);
  };

  // Deck als Raster: Champion zuerst, dann Einheiten, Zauber, Ausrüstung je nach Kosten; jede Kopie einzeln
  const seen = new Map<string, number>();
  const deckTile = (c: DeckCard, label: string, from: Area | null, onRemove?: () => void, extra = '', area = '') => {
    // Besitz zählt über Hauptdeck und Side Deck hinweg; die Kopien im Side Deck kommen nach denen im Hauptdeck
    const i = seen.get(c.id) ?? 0;
    seen.set(c.id, i + 1);
    const lacking = i >= ownedOf(c);
    const own = area ? i - copiesOf(deck, c.id) : i;
    const isFresh = fresh?.id === `${area}${c.id}` && fresh.n === own;
    return (
      <button
        key={`${area}${c.id}#${i}`}
        class={`tile${extra}${lacking ? ' lacking' : ''}${isFresh ? ' fresh' : ''}${c.banned ? ' banned' : ''}`}
        aria-label={`${label}${c.banned ? ' (gesperrt)' : ''}${lacking ? ' (fehlt dir)' : ''}`}
        {...dragOut({ onTap: () => setShown(c, from ?? undefined), onDrop: onRemove, zone: () => pane.current })}
      >
        <img src={thumb(c)} alt="" loading="lazy" draggable={false} />
        {extra === ' champ' && <b class="tile-champ">{starIcon}</b>}
        {c.banned && <BanMark />}
      </button>
    );
  };
  const slots = (n: number, cls = '') => Array.from({ length: Math.max(0, n) }, (_, i) => <i key={`slot-${i}`} class={`slot${cls}`} aria-hidden="true" />);
  const inDeck = Object.entries(deck.cards)
    .map(([id, n]) => ({ card: pool.cards.get(id), n }))
    .filter((e): e is { card: DeckCard; n: number } => !!e.card)
    .sort((a, b) => byKindDomain(a.card, b.card));
  const sideIn = Object.entries(deck.side ?? {})
    .map(([id, n]) => ({ card: pool.cards.get(id), n }))
    .filter((e): e is { card: DeckCard; n: number } => !!e.card)
    .sort((a, b) => byKindDomain(a.card, b.card));
  const runeOrder = (id: string) => {
    const i = runes.findIndex((r) => r.id === id);
    return i < 0 ? runes.length : i;
  };
  const runesIn = Object.entries(deck.runes)
    .map(([id, n]) => ({ card: pool.cards.get(id), n }))
    .filter((e): e is { card: DeckCard; n: number } => !!e.card)
    .sort((a, b) => runeOrder(a.card.id) - runeOrder(b.card.id));
  const fieldsIn = deck.battlefields.map((id) => pool.cards.get(id)).filter((b): b is DeckCard => !!b);
  /** Reihenfolge zum Durchwischen im großen Kartenblatt: jede Karte des Decks einmal, wie im Raster. */
  const tour: { card: DeckCard; from?: Area }[] = [
    ...(champion ? [{ card: champion }] : []),
    ...inDeck.map((e) => ({ card: e.card, from: 'main' as const })),
    ...sideIn.map((e) => ({ card: e.card, from: 'side' as const })),
    ...runesIn.map((e) => ({ card: e.card, from: 'runes' as const })),
    ...fieldsIn.map((card) => ({ card, from: 'fields' as const })),
  ];
  const at = shown ? tour.findIndex((t) => t.card.id === shown.card.id && t.from === shown.from) : -1;
  const nav: CardNav | undefined =
    at < 0
      ? undefined
      : {
          pos: at + 1,
          total: tour.length,
          prev: at > 0 ? () => setShownState(tour[at - 1]) : undefined,
          next: at < tour.length - 1 ? () => setShownState(tour[at + 1]) : undefined,
        };
  /** Letzte Kopie herausgenommen: im Blatt gleich zur Nachbarkarte, sonst schließen. */
  const afterLast = () => setShownState((at >= 0 && (tour[at + 1] ?? tour[at - 1])) || null);
  const broken = check.problems.filter((p) => !p.startsWith('Noch '));

  // Kartenliste: Suche, Filter und Sortierung
  const q = query.trim().toLowerCase();
  const filters = (kind !== 'all' ? 1 : 0) + (energy !== null ? 1 : 0) + (domain ? 1 : 0) + (ownedOnly ? 1 : 0);
  const order: Record<Sort, (a: DeckCard, b: DeckCard) => number> = {
    energy: byCostThenDomain(domainOrder),
    power: byPowerThenDomain(domainOrder),
    kind: byKindDomain,
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
        class={`tile${landscape ? ' landscape' : ''}${count ? ' in' : ''}${blocked ? ' blocked' : ''}${c.banned ? ' banned' : ''}`}
        aria-label={`${name}${c.banned ? ', gesperrt' : ''}, ${count} im Deck, ${own} in Sammlung`}
        aria-disabled={blocked || undefined}
        {...press(onTap, () => setShown(c))}
      >
        <img src={thumb(c)} alt="" loading="lazy" draggable={false} />
        {c.banned && <BanMark />}
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

  /** Anzahl im Hauptdeck oder Side Deck mit − und +. */
  const stepper = (c: DeckCard, area: 'main' | 'side') => {
    const side = area === 'side';
    const n = side ? sideCopiesOf(deck, c.id) : copiesOf(deck, c.id);
    const free = side ? sideRoom(deck, c) : room(deck, c, pool);
    const label = side ? ' im Side Deck' : ' im Deck';
    return (
      <div class="sheet-qty">
        <span>{side ? 'Im Side Deck' : 'Im Deck'}</span>
        <div class="qty">
          <button onClick={() => (side ? removeSide(c) : removeCard(c))} disabled={!n} aria-label={`Eine weniger${label}`}>
            −
          </button>
          <span aria-live="polite">{n}</span>
          <button onClick={() => (side ? addSide(c) : addCard(c))} disabled={free === 0} aria-label={`Eine mehr${label}`}>
            +
          </button>
        </div>
      </div>
    );
  };

  /** Im Deck angetippt: diese Karte herausnehmen oder eine weitere Kopie dazulegen. */
  const deckActions = (c: DeckCard, from: Area) => {
    if (from === 'fields') {
      return (
        <div class="deck-actions">
          <button
            class="remove"
            onClick={() => {
              toggleField(c);
              afterLast();
            }}
          >
            {minusIcon}
            Aus dem Deck nehmen
          </button>
        </div>
      );
    }
    const count = () => (from === 'main' ? copiesOf(current.current, c.id) : from === 'side' ? sideCopiesOf(current.current, c.id) : current.current.runes[c.id] ?? 0);
    const n = count();
    const free = from === 'main' ? room(deck, c, pool) : from === 'side' ? sideRoom(deck, c) : DECK_RULES.runes - runeCount(deck);
    const where = from === 'main' ? 'im Deck' : from === 'side' ? 'im Side Deck' : 'im Deck';
    return (
      <div class="deck-actions">
        <p>
          <strong>{n}×</strong> {where}
        </p>
        <div class="deck-actions-row">
          <button
            class="remove"
            onClick={() => {
              if (from === 'main') removeCard(c);
              else if (from === 'side') removeSide(c);
              else removeRune(c);
              if (!count()) afterLast();
            }}
          >
            {minusIcon}
            Entfernen
          </button>
          <button class="primary" disabled={free <= 0} onClick={() => (from === 'main' ? addCard(c) : from === 'side' ? addSide(c) : addRune(c))}>
            {plusIcon}
            Weitere Kopie
          </button>
        </div>
        {free <= 0 && <small class="muted">{fullText(c, from, deck)}</small>}
      </div>
    );
  };

  /** Im großen Kartenblatt: genaue Anzahl ändern, Champion wechseln, Battlefield wählen. */
  const controls = (c: DeckCard, from?: Area) => {
    if (from && c.id !== deck.champion) {
      const other = from === 'main' ? 'side' : from === 'side' ? 'main' : null;
      return (
        <>
          {deckActions(c, from)}
          {other && stepper(c, other)}
          <WishToggle gameId={pool.gameId} printingId={c.printing.printingId} wish={wish} />
        </>
      );
    }
    if (c.kind === 'battlefield') {
      const chosen = deck.battlefields.includes(c.id);
      return (
        <button class={chosen ? '' : 'primary'} disabled={!chosen && (!!c.banned || deck.battlefields.length >= DECK_RULES.battlefields)} onClick={() => toggleField(c)}>
          {chosen ? 'Aus dem Deck nehmen' : 'Ins Deck legen'}
        </button>
      );
    }
    const isRune = c.kind === 'rune' && runes.some((r) => r.id === c.id);
    if (!isRune && !allowed.has(c.id)) return <WishToggle gameId={pool.gameId} printingId={c.printing.printingId} wish={wish} />;
    const rate = stats && !isRune ? playRate(stats, c.id) : 0;
    const n = isRune ? deck.runes[c.id] ?? 0 : copiesOf(deck, c.id);
    return (
      <>
        {rate > 0 && (
          <p class="meta-rate-line">
            {sparkIcon}
            In {Math.round(rate * 100)} % der Turnierlisten mit {legendTitle(stats!.legend)}
          </p>
        )}
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
        {!isRune && stepper(c, 'side')}
        <WishToggle gameId={pool.gameId} printingId={c.printing.printingId} wish={wish} />
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
          {stats && check.main <= 1 && check.runes === 0 && (
            <button
              class="meta-cta"
              onClick={() => {
                change((d) => buildFromMeta(d, stats, pool, { owned }));
                setFresh(null);
                warn(builtNotice(stats, pool), 5000);
              }}
            >
              {sparkIcon}
              <span>
                <strong>KI-Deck bauen</strong>
              </span>
              <i aria-hidden="true">›</i>
            </button>
          )}

          <h2 class="pane-head main">
            Hauptdeck
            <b class={check.main >= DECK_RULES.main ? 'done' : ''}>
              {check.main}/{DECK_RULES.main}
            </b>
            {check.signatures > 0 && (
              <small>
                Signature {check.signatures}/{DECK_RULES.signatures}
              </small>
            )}
            {power > 0 && (
              <span class="deck-power" aria-label={`${power} Power im Hauptdeck`}>
                {power} Power
              </span>
            )}
          </h2>
          <div class="deck-grid">
            {champion && deckTile(champion, `${cardTitle(champion)}, Champion`, null, undefined, ' champ')}
            {inDeck.flatMap(({ card, n }) => Array.from({ length: n }, () => deckTile(card, cardTitle(card), 'main', () => removeCard(card))))}
            {slots(DECK_RULES.main - check.main)}
          </div>

          <h2 class="pane-head">
            Side Deck
            <b class={check.side > DECK_RULES.side ? 'over' : ''}>
              {check.side}/{DECK_RULES.side}
            </b>
            <small>optional</small>
          </h2>
          <div class="deck-grid side">
            {sideIn.flatMap(({ card, n }) => Array.from({ length: n }, () => deckTile(card, `${cardTitle(card)}, Side Deck`, 'side', () => removeSide(card), '', 'side:')))}
            {slots(DECK_RULES.side - check.side)}
          </div>

          <h2 class="pane-head">
            Runen
            <b class={check.runes === DECK_RULES.runes ? 'done' : ''}>
              {check.runes}/{DECK_RULES.runes}
            </b>
          </h2>
          <div class="deck-grid runes">
            {runesIn.flatMap(({ card, n }) => Array.from({ length: n }, () => deckTile(card, card.name, 'runes', () => removeRune(card))))}
            {slots(DECK_RULES.runes - check.runes)}
          </div>

          <h2 class="pane-head">
            Battlefields
            <b class={check.battlefields === DECK_RULES.battlefields ? 'done' : ''}>
              {check.battlefields}/{DECK_RULES.battlefields}
            </b>
          </h2>
          <div class="deck-grid fields">
            {fieldsIn.map((b) => deckTile(b, b.name, 'fields', () => toggleField(b), ' landscape'))}
            {slots(DECK_RULES.battlefields - fieldsIn.length, ' landscape')}
          </div>
        </div>

        <div class="list-pane">
          <div class="segmented deck-parts" role="radiogroup" aria-label="Karten zum Hinzufügen">
            {(
              [
                ['cards', 'Karten', check.main, DECK_RULES.main],
                ['side', 'Side', check.side, DECK_RULES.side],
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

          {(part === 'cards' || part === 'side') && (
            <>
              <div class="list-tools">
                <input type="search" enterkeyhint="search" placeholder={part === 'side' ? 'Karte fürs Side Deck suchen' : 'Karte suchen'} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
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
                <div class="list-grid">
                  {part === 'side'
                    ? listed.map((c) => listTile(c, sideCopiesOf(deck, c.id), sideRoom(deck, c) === 0, () => addSide(c)))
                    : listed.map((c) => listTile(c, copiesOf(deck, c.id), room(deck, c, pool) === 0, () => addCard(c)))}
                </div>
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
        <CardSheet card={shown.card} owned={ownedOf(shown.card)} price={priceOf(shown.card)} url={urlOf(shown.card)} nav={nav} onClose={() => setShown(null)}>
          {controls(shown.card, shown.from)}
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
      {sheet === 'meta' && stats && meta && (
        <MetaSheet
          deck={deck}
          stats={stats}
          meta={meta}
          pool={pool}
          owned={owned}
          priceOf={priceOf}
          onApply={(built) => {
            change(() => built);
            setFresh(null);
            setSpoken('Deck aus der Meta übernommen');
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'more' && (
        <Sheet label="Deck" onClose={() => setSheet(null)}>
          <h2>{deck.name}</h2>
          <div class="options">
            <button disabled={!stats} onClick={() => setSheet('meta')}>
              <span>KI-Deck: Vorschau und Turnierdecks</span>
              <small class="muted">{stats ? listsLabel(stats) : 'Keine Turnierlisten'}</small>
            </button>
            <button
              onClick={() => {
                setSheet(null);
                onChangeChampion();
              }}
            >
              Champion wechseln
            </button>
            {wish.status === 'ready' && wishable.length > 0 && (
              <button
                onClick={() => {
                  setSheet(null);
                  for (const e of wishable) void wishlist.add(pool.gameId, e.card.printing.printingId, e.lacking);
                  warn(`${wishable.length} ${wishable.length === 1 ? 'Karte' : 'Karten'} auf die Wunschliste gesetzt`);
                }}
              >
                Fehlende auf die Wunschliste ({wishable.length})
              </button>
            )}
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
          {banlist && <BanlistNote banlist={banlist} />}
        </Sheet>
      )}
    </section>
  );
}

/** Durchs Deck blättern: Position und die Nachbarn links und rechts. */
interface CardNav {
  pos: number;
  total: number;
  prev?(): void;
  next?(): void;
}

function CardSheet(props: { card: DeckCard; owned: number; price?: number; url?: string; nav?: CardNav; onClose(): void; children?: ComponentChildren }) {
  const { card, owned, price, url, nav, onClose, children } = props;
  const landscape = card.printing.attributes?.orientation === 'landscape';
  // Richtung des letzten Wechsels: die neue Karte kommt von dieser Seite herein
  const [dir, setDir] = useState(0);
  const go = (d: 1 | -1) => {
    const to = d > 0 ? nav?.next : nav?.prev;
    if (!to) return;
    setDir(d);
    to();
  };
  const navRef = useRef(go);
  navRef.current = go;
  useEffect(() => {
    if (!nav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') navRef.current(1);
      else if (e.key === 'ArrowLeft') navRef.current(-1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [!!nav]);

  return (
    <Sheet class="binder-card" label={cardTitle(card)} onClose={onClose}>
      <div class="card-swipe">
        <div key={card.id} class={`card-swipe-body${dir > 0 ? ' from-right' : dir < 0 ? ' from-left' : ''}`}>
          <div class={`card-stage${nav ? ' nav' : ''}`}>
            {nav && (
              <button class="tool" aria-label="Vorherige Karte im Deck" disabled={!nav.prev} onClick={() => go(-1)}>
                ‹
              </button>
            )}
            <img
              class={landscape ? 'landscape' : ''}
              src={card.printing.imageUrl}
              srcset={cardSrcSet(card.printing.imageUrl, [480, 720, 960])}
              sizes={landscape ? 'min(72vw, 420px)' : 'min(62vw, 260px)'}
              alt={cardTitle(card)}
              draggable={false}
            />
            {nav && (
              <button class="tool" aria-label="Nächste Karte im Deck" disabled={!nav.next} onClick={() => go(1)}>
                ›
              </button>
            )}
          </div>
          {nav && (
            <span class="card-pos" aria-live="polite">
              {nav.pos} von {nav.total}
            </span>
          )}
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
            {card.banned && (
              <p class="ban-line">
                {banIcon}
                <span>
                  {banLabel(card.banned)}: Diese Karte darfst du bei offiziellen Turnieren nicht spielen.{' '}
                  <a href={card.banned.source} target="_blank" rel="noopener">
                    Banlist ↗
                  </a>
                </span>
              </p>
            )}
            {url && (
              <a href={url} target="_blank" rel="noopener">
                Bei Cardmarket ansehen ↗
              </a>
            )}
          </div>
        </div>
      </div>
      {children}
    </Sheet>
  );
}

/** Schild „Gesperrt“ auf einer Karte im Raster. */
function BanMark() {
  return (
    <b class="tile-ban" aria-hidden="true">
      {banIcon}
      <span>Gesperrt</span>
    </b>
  );
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

/** Woher die Banlist stammt und wie alt sie ist. */
export function BanlistNote({ banlist }: { banlist: BanlistFile }) {
  return (
    <p class="meta-note center">
      Gesperrte Karten nach der{' '}
      <a href={banlist.sourceUrl} target="_blank" rel="noopener">
        Banlist von {banlist.source}
      </a>
      , Stand {DAY.format(new Date(`${banlist.updatedAt}T12:00:00Z`))}
    </p>
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

const minusIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  </svg>
);

const plusIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  </svg>
);

/** „76 Turnierlisten“, bei wenigen Listen mit den Community-Decks dazu. */
export function listsLabel(stats: MetaStats): string {
  const t = `${stats.decks} ${stats.decks === 1 ? 'Turnierliste' : 'Turnierlisten'}`;
  return stats.community ? `${t} und ${stats.community} Community-Decks` : t;
}

const builtNotice = (stats: MetaStats, pool: DeckPool) => {
  const banned = metaBanned(stats, pool).length;
  return `KI-Deck aus ${listsLabel(stats)} gebaut${banned ? `, ohne ${banned === 1 ? 'die gesperrte Karte' : `${banned} gesperrte Karten`}` : ''}`;
};

const trophyMini = (
  <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
    <path d="M7 3h10v6a5 5 0 0 1-10 0V3zM7 5H4a3.5 3.5 0 0 0 3 5M17 5h3a3.5 3.5 0 0 1-3 5M12 14v4M8 21h8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

const zoomIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4M11 8v6M8 11h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
);

const banIcon = (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.6" />
    <path d="M6 18 18 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
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
