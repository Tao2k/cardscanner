import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CollectionService } from '../core/collection';
import { loadGames, type CatalogFile, type GameEntry } from '../core/catalog';
import { loadPrices, type PriceEntry, type PriceFile } from '../core/prices';
import { collectionMovers, loadPriceHistory, moverKey, priceAlerts, type PriceHistoryFile } from '../core/priceHistory';
import type { CardSet, CollectionItem, LanguageInfo, Printing } from '../core/types';
import { IndexedDbSampleStore } from '../storage/indexeddb';
import { SyncingStore } from '../storage/outbox';
import { DeckStore } from '../storage/decks';
import type { Deck } from '../core/deck';
import { cloud, cloudConfigured, useCloud } from './cloud';
import { LoginScreen, needsLogin } from './AccountView';
import { LearningService } from '../core/learning';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { Recognizer } from './recognizer';
import { ScanView } from './ScanView';
import { CollectionView } from './CollectionView';
import { PriceView } from './PriceView';
import { CommunityView, WishlistView, takeInvite } from './TradeView';
import { DeckView } from './DeckView';
import { ProfileView } from './ProfileView';
import { updates, useUpdatePending } from './updates';
import { withoutLast } from './binder';
import { markChangesSeen, pendingChanges, WhatsNewSheet } from './WhatsNew';
import { useWishAlarm, useWishlist } from './wishlist';
import { useBack } from './back';

const BASE = import.meta.env.BASE_URL;

export interface Catalogs {
  games: GameEntry[];
  byGame: Map<string, Map<string, Printing>>;
  /** Drucke in Katalogreihenfolge (Index = Ergebnis der Erkennung). */
  ordered: Map<string, Printing[]>;
  languages: Map<string, LanguageInfo[]>;
  /** Sets je Spiel in Katalogreihenfolge (für die Sortierung im Export). */
  sets: Map<string, CardSet[]>;
  lookup(gameId: string, printingId: string): Printing | undefined;
  /** Marktpreise je Spiel (fehlt, wenn es für das Spiel keine gibt). */
  prices: Map<string, PriceFile>;
  price(gameId: string, printingId: string): PriceEntry | undefined;
  /** Vergleichsbilder eines Drucks für Zustand und Foil (URLs, leer bei alten Katalogen). */
  compareRefs(gameId: string, printingId: string): string[];
}

type Tab = 'scan' | 'collection' | 'prices' | 'community' | 'profile';
/** Bereiche im Tab „Sammlung“: Karten (Binder/Liste), Decks und Wunschliste. */
type Shelf = 'cards' | 'decks' | 'wishlist';

export function App() {
  const store = useMemo(() => new SyncingStore(), []);
  const service = useMemo(() => new CollectionService(store), []);
  const deckStore = useMemo(() => new DeckStore(), []);
  const [decks, setDecks] = useState<Deck[]>([]);
  const learning = useMemo(() => new LearningService(new IndexedDbSampleStore()), []);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [recognizer, setRecognizer] = useState<Recognizer | null>(null);
  const [status, setStatus] = useState('Lade Kartenkataloge …');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  /** Freundescode aus einem Einladungslink: App startet dann bei „Community“. */
  const [invite, setInvite] = useState(() => (cloudConfigured ? takeInvite() : null));
  const [tab, setTabState] = useState<Tab>(invite ? 'community' : 'scan');
  const [shelf, setShelf] = useState<Shelf>('cards');
  /** Tab, zu dem „Zurück“ im Profil führt (das Profil sitzt oben rechts, nicht in der Leiste). */
  const [lastTab, setLastTab] = useState<Tab>('scan');
  const setTab = (next: Tab) => {
    if (next === 'profile' && tab !== 'profile') setLastTab(tab);
    setTabState(next);
  };
  // Zurück-Taste (Android): von einem anderen Tab erst zu „Scannen“, erst dort verlässt „Zurück“ die App.
  // Das Profil meldet sich selbst an (es führt zurück zum vorherigen Tab).
  useBack(tab !== 'scan' && tab !== 'profile', () => setTab('scan'));
  /** Preisverlauf je Spiel; lädt nach den Katalogen, weil ihn nur „Preise“ und die Markierungen brauchen. */
  const [histories, setHistories] = useState<Map<string, PriceHistoryFile>>(new Map());
  const updatePending = useUpdatePending();
  const account = useCloud();
  /** Preisalarme der Wunschliste, als Zähler an „Sammlung“ und „Wunschliste“. */
  const wishAlarm = useWishAlarm(useWishlist(), catalogs);

  const setPrefs = (patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  };
  const refresh = () => service.list().then(setItems);
  const refreshDecks = () => deckStore.list().then(setDecks);
  /** Sofort anzeigen, im Hintergrund speichern (und später mit dem Server abgleichen). */
  const saveDeck = (deck: Deck) => {
    const saved = { ...deck, updatedAt: new Date().toISOString() };
    setDecks((list) => [saved, ...list.filter((d) => d.deckId !== deck.deckId)]);
    deckStore.save(saved);
  };
  const deleteDeck = (deckId: string) => {
    setDecks((list) => list.filter((d) => d.deckId !== deckId));
    deckStore.remove(deckId);
  };
  /** Nach Bestätigen/Korrigieren: Erkennung liest die eigenen Scans neu ein. */
  const relearn = async () => {
    if (recognizer && prefs.gameId) await recognizer.reloadSamples(prefs.gameId);
  };

  useEffect(() => {
    refresh();
    refreshDecks();
    // Angemeldet: Sammlung und Decks mit dem Server abgleichen; Änderungen von anderen Geräten neu anzeigen
    cloud.init(store, deckStore, () => {
      refresh();
      refreshDecks();
    });
    (async () => {
      try {
        const games = await loadGames(BASE);
        const byGame = new Map<string, Map<string, Printing>>();
        const ordered = new Map<string, Printing[]>();
        const languages = new Map<string, LanguageInfo[]>();
        const sets = new Map<string, CardSet[]>();
        const compare = new Map<string, Map<string, string[]>>();
        const prices = new Map<string, PriceFile>();
        for (const g of games) {
          const pricesLoaded = loadPrices(BASE, g.gameId);
          const file: CatalogFile = await fetch(`${BASE}data/${g.gameId}/catalog.json`).then((r) => r.json());
          byGame.set(g.gameId, new Map(file.printings.map((p) => [p.printingId, p])));
          ordered.set(g.gameId, file.printings);
          languages.set(g.gameId, file.meta.languages ?? [{ code: 'en', label: 'EN' }]);
          sets.set(g.gameId, file.meta.sets ?? []);
          const byPrinting = new Map<string, string[]>();
          for (const ref of file.refs) {
            if (!ref.g) continue;
            const id = file.printings[ref.p].printingId;
            byPrinting.set(id, [...(byPrinting.get(id) ?? []), `${BASE}data/${g.gameId}/${ref.g}`]);
          }
          compare.set(g.gameId, byPrinting);
          const priceFile = await pricesLoaded;
          if (priceFile) prices.set(g.gameId, priceFile);
        }
        setCatalogs({
          games,
          byGame,
          ordered,
          languages,
          sets,
          lookup: (gameId, id) => byGame.get(gameId)?.get(id),
          prices,
          price: (gameId, id) => prices.get(gameId)?.prices[id],
          compareRefs: (gameId, id) => compare.get(gameId)?.get(id) ?? [],
        });
        if (!games.some((g) => g.gameId === prefs.gameId) && games[0]) setPrefs({ gameId: games[0].gameId });
        Promise.all(games.map(async (g) => [g.gameId, await loadPriceHistory(BASE, g.gameId)] as const)).then((loaded) =>
          setHistories(new Map(loaded.filter((e): e is [string, PriceHistoryFile] => !!e[1]))),
        );
        const r = new Recognizer(BASE, games.map((g) => g.gameId), setStatus);
        setRecognizer(r);
        await r.ready;
        setStatus('');
        const gameId = games.some((g) => g.gameId === prefs.gameId) ? prefs.gameId : games[0]?.gameId;
        if (gameId) await r.reloadSamples(gameId);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const movers = useMemo(
    () => (catalogs ? collectionMovers(items, histories, catalogs.lookup, prefs.pricePeriod, catalogs.price) : []),
    [items, histories, catalogs, prefs.pricePeriod],
  );
  // Preiswarnungen: deutlich gestiegene eigene Karten, seit der letzten Warnung zu dieser Karte
  // Erster Start nach einem Update: einmal zeigen, was sich geändert hat
  const [news, setNews] = useState(pendingChanges);
  const [seenPrices, setSeenPrices] = useState<Record<string, number>>(loadSeenPrices);
  const alerts = useMemo(() => priceAlerts(movers, seenPrices), [movers, seenPrices]);
  /** Warnungen, die beim Öffnen von „Preise“ neu waren; dort als „Neu“ markiert, bis man den Tab verlässt. */
  const [freshAlerts, setFreshAlerts] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Die Sammlung hat die neuen Karten beim Öffnen übernommen (für den Binder), danach zählen sie nicht mehr als neu
    if (tab === 'collection' && shelf === 'cards' && catalogs && (prefs.newScans || prefs.binderNew.length)) setPrefs({ newScans: 0, binderNew: [] });
    if (tab !== 'prices') {
      if (freshAlerts.size) setFreshAlerts(new Set());
      return;
    }
    if (!alerts.length) return;
    setFreshAlerts((fresh) => new Set([...fresh, ...alerts.map(moverKey)]));
    const next = { ...seenPrices, ...Object.fromEntries(alerts.map((m) => [moverKey(m), m.to])) };
    setSeenPrices(next);
    saveSeenPrices(next);
  }, [tab, shelf, alerts, prefs.newScans, catalogs]);

  /**
   * Gescannt oder rückgängig gemacht: Zähler am Tab „Sammlung“ und Karten, die in den Binder fliegen
   * (funktional, weil mehrere Scans schnell folgen können).
   */
  const countScan = (delta: number, key: string) =>
    setPrefsState((p) => {
      const binderNew = delta > 0 ? [...p.binderNew, key] : withoutLast(p.binderNew, key);
      const next = { ...p, newScans: Math.max(0, p.newScans + delta), binderNew };
      savePrefs(next);
      return next;
    });
  /** Scan auf einen anderen Druck korrigiert: Er fliegt dann in dessen Platz. */
  const moveScan = (from: string, to: string) =>
    setPrefsState((p) => {
      if (!p.binderNew.includes(from)) return p;
      const next = { ...p, binderNew: [...withoutLast(p.binderNew, from), to] };
      savePrefs(next);
      return next;
    });

  if (needsLogin(account)) return <LoginScreen state={account} />;

  // Die Wunschliste liegt auf dem Server, also nur angemeldet
  const shelves: [Shelf, string][] = [['cards', 'Karten'], ['decks', 'Decks'], ...(account.signedIn ? [['wishlist', 'Wunschliste'] as [Shelf, string]] : [])];
  const currentShelf = shelves.some(([s]) => s === shelf) ? shelf : 'cards';

  return (
    <div class="app">
      <header class="brand">
        <img src={`${BASE}icon-192.png`} alt="" width={28} height={28} />
        <span>
          Scann<b>R</b>
        </span>
        <button
          class={`profile-button${tab === 'profile' ? ' active' : ''}`}
          aria-label="Profil"
          aria-current={tab === 'profile' ? 'page' : undefined}
          onClick={() => setTab(tab === 'profile' ? lastTab : 'profile')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="9" r="3.5" />
            <path d="M5.5 19a7 7 0 0 1 13 0" />
          </svg>
        </button>
      </header>
      <main>
        {/* Auf „Scannen“ steht derselbe Fehler schon unter dem Startknopf */}
        {error && !(tab === 'scan' && status.startsWith('Fehler')) && <p class="banner error">{error}</p>}
        {updatePending && (
          <p class="banner update" role="status">
            Neue Version verfügbar.
            <button class="link" onClick={() => updates.applyNow()}>Neu laden</button>
          </p>
        )}
        {tab === 'scan' && (
          <ScanView
            catalogs={catalogs}
            recognizer={recognizer}
            status={status}
            prefs={prefs}
            setPrefs={setPrefs}
            service={service}
            learning={learning}
            onChange={refresh}
            onAdded={countScan}
            onMoved={moveScan}
            onLearn={relearn}
          />
        )}
        {tab === 'collection' && (
          <div class="shelf-head">
            <h1>Sammlung</h1>
            <div class="segmented" role="radiogroup" aria-label="Bereich der Sammlung">
              {shelves.map(([value, label]) => (
                <button role="radio" aria-checked={currentShelf === value} class={currentShelf === value ? 'active' : ''} onClick={() => setShelf(value)}>
                  {label}
                  {value === 'wishlist' && wishAlarm.alerts.length > 0 && currentShelf !== 'wishlist' && (
                    <span class="seg-count" aria-label={`${wishAlarm.alerts.length} Preisalarm`}>
                      {wishAlarm.alerts.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'collection' && currentShelf === 'cards' && catalogs && (
          <CollectionView items={items} catalogs={catalogs} service={service} prefs={prefs} setPrefs={setPrefs} histories={histories} onChange={refresh} onOpenProfile={() => setTab('profile')} />
        )}
        {tab === 'collection' && currentShelf === 'decks' && catalogs && (
          <DeckView catalogs={catalogs} items={items} decks={decks} gameId={prefs.gameId} onSave={saveDeck} onDelete={deleteDeck} />
        )}
        {tab === 'collection' && currentShelf === 'wishlist' && catalogs && <WishlistView items={items} catalogs={catalogs} gameId={prefs.gameId} />}
        {tab === 'prices' && catalogs && (
          <PriceView items={items} catalogs={catalogs} histories={histories} prefs={prefs} setPrefs={setPrefs} fresh={freshAlerts} />
        )}
        {tab === 'community' && catalogs && account.signedIn && (
          <CommunityView items={items} catalogs={catalogs} invite={invite} onInviteUsed={() => setInvite(null)} />
        )}
        {tab === 'profile' && <ProfileView items={items} catalogs={catalogs} onBack={() => setTab(lastTab)} />}
        {tab !== 'scan' && tab !== 'profile' && !catalogs && !error && (
          <p class="loading" role="status">
            <span class="spinner" />
            Lade Katalog …
          </p>
        )}
      </main>
      <nav class={`tabs ${account.signedIn ? 'four' : 'three'}`} aria-label="Bereiche">
        <button data-tab="scan" class={tab === 'scan' ? 'active' : ''} aria-label="Scannen" aria-current={tab === 'scan' ? 'page' : undefined} onClick={() => setTab('scan')}>
          {tabIcon(<>
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M4 12h16" />
          </>)}
        </button>
        <button
          data-tab="collection"
          class={tab === 'collection' ? 'active' : ''}
          aria-label={prefs.newScans > 0 ? `Sammlung, ${prefs.newScans} neu` : wishAlarm.alerts.length > 0 ? `Sammlung, ${wishAlarm.alerts.length} Preisalarm` : 'Sammlung'}
          aria-current={tab === 'collection' ? 'page' : undefined}
          onClick={() => {
            // Neue Scans fliegen in den Binder, also dann direkt zu den Karten
            if (prefs.newScans > 0) setShelf('cards');
            setTab('collection');
          }}
        >
          {tabIcon(<>
            <rect x="3" y="7" width="12" height="14" rx="2" />
            <path d="M8 3h11a2 2 0 0 1 2 2v12" />
          </>)}
          {prefs.newScans > 0 ? (
            <span class="count" key={prefs.newScans}>{prefs.newScans}</span>
          ) : (
            wishAlarm.alerts.length > 0 && !(tab === 'collection' && currentShelf === 'wishlist') && <span class="count accent">{wishAlarm.alerts.length}</span>
          )}
        </button>
        <button
          data-tab="prices"
          class={tab === 'prices' ? 'active' : ''}
          aria-label={alerts.length > 0 ? `Preise, ${alerts.length} Warnungen` : 'Preise'}
          aria-current={tab === 'prices' ? 'page' : undefined}
          onClick={() => setTab('prices')}
        >
          {tabIcon(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />)}
          {alerts.length > 0 && <span class="count accent">{alerts.length}</span>}
        </button>
        {account.signedIn && (
          <button data-tab="community" class={tab === 'community' ? 'active' : ''} aria-label="Community" aria-current={tab === 'community' ? 'page' : undefined} onClick={() => setTab('community')}>
            {tabIcon(<>
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2a6.5 6.5 0 0 1 3 5.8" />
            </>)}
          </button>
        )}
      </nav>
      {news.length > 0 && (
        <WhatsNewSheet
          entries={news}
          onClose={() => {
            markChangesSeen();
            setNews([]);
          }}
        />
      )}
    </div>
  );
}

/** Strich-Symbol für die Navigation unten (ohne Beschriftung; der Name steht im aria-label). */
function tabIcon(shape: ComponentChildren) {
  return (
    <span class="tab-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {shape}
      </svg>
    </span>
  );
}

const SEEN_KEY = 'cardscanner.priceSeen';

/** Zuletzt gemeldeter Preis je Druck und Ausführung (Schlüssel moverKey). */
function loadSeenPrices(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveSeenPrices(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* ohne Speicher kommen die Warnungen beim nächsten Start erneut */
  }
}
