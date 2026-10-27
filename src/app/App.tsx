import { useEffect, useMemo, useState } from 'preact/hooks';
import { CollectionService } from '../core/collection';
import { loadGames, type CatalogFile, type GameEntry } from '../core/catalog';
import { loadPrices, type PriceEntry, type PriceFile } from '../core/prices';
import { collectionMovers, loadPriceHistory, moverKey, priceAlerts, type PriceHistoryFile } from '../core/priceHistory';
import type { CardSet, CollectionItem, LanguageInfo, Printing } from '../core/types';
import { IndexedDbSampleStore, IndexedDbStore } from '../storage/indexeddb';
import { LearningService } from '../core/learning';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { Recognizer, type Learned } from './recognizer';
import { ScanView } from './ScanView';
import { CollectionView } from './CollectionView';
import { ReviewView } from './ReviewView';
import { PriceView } from './PriceView';
import { updates, useUpdatePending } from './updates';
import { withoutLast } from './binder';

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

type Tab = 'scan' | 'collection' | 'prices' | 'review';

export function App() {
  const service = useMemo(() => new CollectionService(new IndexedDbStore()), []);
  const learning = useMemo(() => new LearningService(new IndexedDbSampleStore()), []);
  const [learned, setLearned] = useState<Learned | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [recognizer, setRecognizer] = useState<Recognizer | null>(null);
  const [status, setStatus] = useState('Lade Kartenkataloge …');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [tab, setTab] = useState<Tab>('scan');
  /** Preisverlauf je Spiel; lädt nach den Katalogen, weil ihn nur „Preise“ und die Markierungen brauchen. */
  const [histories, setHistories] = useState<Map<string, PriceHistoryFile>>(new Map());
  const updatePending = useUpdatePending();

  const setPrefs = (patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  };
  const refresh = () => service.list().then(setItems);
  /** Nach Bestätigen/Korrigieren: Erkennung liest die eigenen Scans neu ein. */
  const relearn = async () => {
    if (recognizer && prefs.gameId) setLearned(await recognizer.reloadSamples(prefs.gameId));
  };

  useEffect(() => {
    refresh();
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
        if (gameId) setLearned(await r.reloadSamples(gameId));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const toReview = items.filter((i) => !i.confirmed).length;
  const movers = useMemo(
    () => (catalogs ? collectionMovers(items, histories, catalogs.lookup, prefs.pricePeriod, catalogs.price) : []),
    [items, histories, catalogs, prefs.pricePeriod],
  );
  // Preiswarnungen: deutlich gestiegene eigene Karten, seit der letzten Warnung zu dieser Karte
  const [seenPrices, setSeenPrices] = useState<Record<string, number>>(loadSeenPrices);
  const alerts = useMemo(() => priceAlerts(movers, seenPrices), [movers, seenPrices]);
  /** Warnungen, die beim Öffnen von „Preise“ neu waren; dort als „Neu“ markiert, bis man den Tab verlässt. */
  const [freshAlerts, setFreshAlerts] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Die Sammlung hat die neuen Karten beim Öffnen übernommen (für den Binder), danach zählen sie nicht mehr als neu
    if (tab === 'collection' && catalogs && (prefs.newScans || prefs.binderNew.length)) setPrefs({ newScans: 0, binderNew: [] });
    if (tab !== 'prices') {
      if (freshAlerts.size) setFreshAlerts(new Set());
      return;
    }
    if (!alerts.length) return;
    setFreshAlerts((fresh) => new Set([...fresh, ...alerts.map(moverKey)]));
    const next = { ...seenPrices, ...Object.fromEntries(alerts.map((m) => [moverKey(m), m.to])) };
    setSeenPrices(next);
    saveSeenPrices(next);
  }, [tab, alerts, prefs.newScans, catalogs]);

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

  return (
    <div class="app">
      <header class="brand">
        <img src={`${BASE}icon-192.png`} alt="" width={28} height={28} />
        <span>
          Scann<b>R</b>
        </span>
      </header>
      <main>
        {error && <p class="banner error">{error}</p>}
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
        {tab === 'collection' && catalogs && (
          <CollectionView items={items} catalogs={catalogs} service={service} prefs={prefs} setPrefs={setPrefs} histories={histories} onChange={refresh} />
        )}
        {tab === 'prices' && catalogs && (
          <PriceView items={items} catalogs={catalogs} histories={histories} prefs={prefs} setPrefs={setPrefs} fresh={freshAlerts} />
        )}
        {tab === 'review' && catalogs && (
          <ReviewView
            items={items}
            catalogs={catalogs}
            service={service}
            learning={learning}
            learned={learned}
            gameId={prefs.gameId}
            onChange={refresh}
            onLearn={relearn}
          />
        )}
      </main>
      <nav class="tabs">
        <button class={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>
          {tabIcon('M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 8h6v8H9z')}
          Scannen
        </button>
        <button data-tab="collection" class={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}>
          {tabIcon('M8 4h10a2 2 0 0 1 2 2v12M6 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z')}
          Sammlung {prefs.newScans > 0 && <span class="count" key={prefs.newScans}>{prefs.newScans}</span>}
        </button>
        <button data-tab="prices" class={tab === 'prices' ? 'active' : ''} onClick={() => setTab('prices')}>
          {tabIcon('M3 17l6-6 4 4 8-8M15 7h6v6')}
          Preise {alerts.length > 0 && <span class="count accent">{alerts.length}</span>}
        </button>
        <button class={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          {tabIcon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.5 2.5L16 9.5')}
          Prüfen {toReview > 0 && <span class="count warn">{toReview}</span>}
        </button>
      </nav>
    </div>
  );
}

/** Strich-Symbol für die Navigation unten. */
function tabIcon(d: string) {
  return (
    <span class="tab-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
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
