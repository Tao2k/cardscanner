import { useEffect, useMemo, useState } from 'preact/hooks';
import { CollectionService } from '../core/collection';
import { loadGames, type CatalogFile, type GameEntry } from '../core/catalog';
import { loadPrices, type PriceEntry, type PriceFile } from '../core/prices';
import type { CardSet, CollectionItem, LanguageInfo, Printing } from '../core/types';
import { IndexedDbSampleStore, IndexedDbStore } from '../storage/indexeddb';
import { LearningService } from '../core/learning';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { Recognizer, type Learned } from './recognizer';
import { ScanView } from './ScanView';
import { CollectionView } from './CollectionView';
import { ReviewView } from './ReviewView';
import { updates, useUpdatePending } from './updates';

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

type Tab = 'scan' | 'collection' | 'review';

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
  const total = items.reduce((n, i) => n + i.quantity, 0);

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
            onLearn={relearn}
          />
        )}
        {tab === 'collection' && catalogs && (
          <CollectionView items={items} catalogs={catalogs} service={service} prefs={prefs} setPrefs={setPrefs} onChange={refresh} />
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
          Sammlung <span class="count" key={total}>{total}</span>
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
