import { useEffect, useMemo, useState } from 'preact/hooks';
import { CollectionService } from '../core/collection';
import { loadGames, type CatalogFile, type GameEntry } from '../core/catalog';
import type { CollectionItem, Printing } from '../core/types';
import { IndexedDbStore } from '../storage/indexeddb';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { Recognizer } from './recognizer';
import { ScanView } from './ScanView';
import { CollectionView } from './CollectionView';
import { ReviewView } from './ReviewView';

const BASE = import.meta.env.BASE_URL;

export interface Catalogs {
  games: GameEntry[];
  byGame: Map<string, Map<string, Printing>>;
  lookup(gameId: string, printingId: string): Printing | undefined;
}

type Tab = 'scan' | 'collection' | 'review';

export function App() {
  const service = useMemo(() => new CollectionService(new IndexedDbStore()), []);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [recognizer, setRecognizer] = useState<Recognizer | null>(null);
  const [status, setStatus] = useState('Lade Kartenkataloge …');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [tab, setTab] = useState<Tab>('scan');

  const setPrefs = (patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  };
  const refresh = () => service.list().then(setItems);

  useEffect(() => {
    refresh();
    (async () => {
      try {
        const games = await loadGames(BASE);
        const byGame = new Map<string, Map<string, Printing>>();
        for (const g of games) {
          const file: CatalogFile = await fetch(`${BASE}data/${g.gameId}/catalog.json`).then((r) => r.json());
          byGame.set(g.gameId, new Map(file.printings.map((p) => [p.printingId, p])));
        }
        setCatalogs({ games, byGame, lookup: (gameId, id) => byGame.get(gameId)?.get(id) });
        if (!games.some((g) => g.gameId === prefs.gameId) && games[0]) setPrefs({ gameId: games[0].gameId });
        const r = new Recognizer(BASE, games.map((g) => g.gameId), setStatus);
        setRecognizer(r);
        await r.ready;
        setStatus('');
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const toReview = items.filter((i) => !i.confirmed).length;

  return (
    <div class="app">
      <main>
        {error && <p class="banner error">{error}</p>}
        {tab === 'scan' && (
          <ScanView
            catalogs={catalogs}
            recognizer={recognizer}
            status={status}
            prefs={prefs}
            setPrefs={setPrefs}
            service={service}
            onChange={refresh}
          />
        )}
        {tab === 'collection' && catalogs && (
          <CollectionView items={items} catalogs={catalogs} service={service} prefs={prefs} setPrefs={setPrefs} onChange={refresh} />
        )}
        {tab === 'review' && catalogs && <ReviewView items={items} catalogs={catalogs} service={service} onChange={refresh} />}
      </main>
      <nav class="tabs">
        <button class={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>Scannen</button>
        <button class={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}>
          Sammlung <span class="count">{items.reduce((n, i) => n + i.quantity, 0)}</span>
        </button>
        <button class={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          Prüfen {toReview > 0 && <span class="count warn">{toReview}</span>}
        </button>
      </nav>
    </div>
  );
}
