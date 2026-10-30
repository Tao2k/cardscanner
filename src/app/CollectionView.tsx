import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CollectionService } from '../core/collection';
import { compareCollectorNumbers, exportOrder, exportWorkbook } from '../core/excel';
import type { CollectionItem, Finish, Printing } from '../core/types';
import type { Catalogs } from './App';
import { Sheet } from './Sheet';
import { downloadBlob, printingCode } from './format';
import { nameIn } from '../core/catalog';
import { formatAsOf, formatEur, itemPrice, priceFor } from '../core/prices';
import type { CollectionSort, CollectionViewMode, Prefs } from './prefs';
import { collectionMovers, moverKey, type Mover, type PriceHistoryFile } from '../core/priceHistory';
import { groupBySet, groupChange, MoveCol, SetSection, SIGNED_EUR, toggled, trend } from './SetList';
import { buildBinders } from './binder';
import { BinderView } from './BinderView';
import { CloudLine } from './AccountView';
import { useCloud } from './cloud';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  service: CollectionService;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  /** Preisverlauf je Spiel, für die Preisentwicklung wie im Tab „Preise“. */
  histories: Map<string, PriceHistoryFile>;
  onChange(): void;
}

/** Zeile der Liste: ein Eintrag der Sammlung oder ein Druck, den man (noch) nicht hat. */
interface Row {
  key: string;
  gameId: string;
  printingId: string;
  printing?: Printing;
  item?: CollectionItem;
  finish: Finish;
  price?: number;
}

/** Ausführung, mit der ein fehlender Druck verglichen wird: Foil nur bei reinen Foil-Drucken. */
const defaultFinish = (p: Printing): Finish => (p.finishes?.length === 1 && p.finishes[0] === 'foil' ? 'foil' : 'normal');
const day = (d: string) => formatAsOf(`${d}T12:00:00Z`);
const basisLabel = (m: Mover) => (m.basis.kind === 'history' ? `seit ${day(m.basis.since)}` : `ggü. Ø ${m.basis.days} Tage`);

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_REMINDER_DAYS = 7;
const SORTS: { value: CollectionSort; label: string }[] = [
  { value: 'set', label: 'Set und Sammlernummer' },
  { value: 'recent', label: 'Zuletzt gescannt' },
  { value: 'price', label: 'Preis, teuerste zuerst' },
];

export function CollectionView({ items, catalogs, service, prefs, setPrefs, histories, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Angemeldet ist der Server die Sicherung; dann keine Erinnerung an den Excel-Export. */
  const account = useCloud();
  const [sorting, setSorting] = useState(false);
  /** Eintrag, dessen Sprache und Marktplatz-Link aufgeklappt sind. */
  const [open, setOpen] = useState<string | null>(null);
  /** Seit dem letzten Besuch gescannt: fliegt beim ersten Öffnen in den Binder, daher öffnet die Sammlung dann im Binder. */
  const arriving = useRef(prefs.binderNew);
  useEffect(() => {
    arriving.current = [];
  }, []);
  const [view, setView] = useState<CollectionViewMode>(() => (arriving.current.length ? 'binder' : prefs.collectionView));
  const showView = (v: CollectionViewMode) => {
    setView(v);
    setPrefs({ collectionView: v });
  };

  const binders = useMemo(
    () => buildBinders([prefs.gameId, ...items.map((i) => i.gameId)], catalogs.byGame, catalogs.sets, items),
    [items, catalogs, prefs.gameId],
  );
  const [binderKey, setBinderKey] = useState(() => {
    const fresh = new Set(arriving.current);
    return binders.find((b) => b.slots.some((s) => fresh.has(s.key)))?.key ?? prefs.binderSet;
  });
  const selectBinder = (key: string) => {
    setBinderKey(key);
    setPrefs({ binderSet: key });
  };
  const selectedBinder = binders.find((b) => b.key === binderKey) ?? binders.find((b) => b.owned > 0) ?? binders[0];

  // Alle Drucke der Spiele in der Sammlung (und des gewählten Spiels), auch die, die man nicht hat
  const catalogRows = useMemo(() => {
    const games = new Set([prefs.gameId, ...items.map((i) => i.gameId)]);
    const owned = new Set(items.map((i) => `${i.gameId}|${i.printingId}`));
    const rows: Row[] = [];
    for (const gameId of games) {
      for (const printing of catalogs.byGame.get(gameId)?.values() ?? []) {
        if (owned.has(`${gameId}|${printing.printingId}`)) continue;
        const finish = defaultFinish(printing);
        const price = priceFor(catalogs.price(gameId, printing.printingId), finish, printing);
        rows.push({ key: `missing|${gameId}|${printing.printingId}`, gameId, printingId: printing.printingId, printing, finish, price });
      }
    }
    return rows;
  }, [items, catalogs, prefs.gameId]);

  // Preisentwicklung wie im Tab „Preise“, für eigene und fehlende Karten
  const movers = useMemo(() => {
    const missing = catalogRows.map(
      (r): CollectionItem => ({ itemId: r.key, gameId: r.gameId, printingId: r.printingId, language: '', quantity: 1, condition: 'NM', finish: r.finish, location: '', notes: '', confirmed: true, addedAt: '', updatedAt: '' }),
    );
    return new Map(collectionMovers([...items, ...missing], histories, catalogs.lookup, prefs.pricePeriod, catalogs.price).map((m) => [moverKey(m), m]));
  }, [items, catalogRows, histories, catalogs, prefs.pricePeriod]);

  const q = query.trim().toLowerCase();
  const matches = (printing: Printing | undefined, extra = '') =>
    !q || `${printing?.cardName} ${printing?.setCode} ${printing?.collectorNumber} ${extra}`.toLowerCase().includes(q);
  const ownedRows: Row[] = items
    .map((item) => {
      const printing = catalogs.lookup(item.gameId, item.printingId);
      return { key: item.itemId, gameId: item.gameId, printingId: item.printingId, printing, item, finish: item.finish, price: itemPrice(item, catalogs.price, printing) };
    })
    .filter((r) => matches(r.printing, `${r.printing ? nameIn(r.printing, r.item.language) : ''} ${r.item.location}`));
  const rows = [...ownedRows, ...(prefs.collectionOwnedOnly ? [] : catalogRows.filter((r) => matches(r.printing)))];

  // Je Set: wie viele verschiedene Drucke man hat, von wie vielen, und ihr Wert
  const setStats = new Map<string, { owned: Set<string>; total: number; value: number }>();
  const statsOf = (gameId: string, code: string) => {
    const key = `${gameId}|${code}`;
    let stats = setStats.get(key);
    if (!stats) setStats.set(key, (stats = { owned: new Set(), total: 0, value: 0 }));
    return stats;
  };
  for (const r of catalogRows) statsOf(r.gameId, r.printing?.setCode ?? '').total++;
  for (const item of items) {
    const printing = catalogs.lookup(item.gameId, item.printingId);
    const stats = statsOf(item.gameId, printing?.setCode ?? '');
    if (!stats.owned.has(item.printingId)) stats.total++;
    stats.owned.add(item.printingId);
    stats.value += (itemPrice(item, catalogs.price, printing) ?? 0) * item.quantity;
  }

  const bySetOrder = exportOrder(catalogs.lookup, catalogs.sets);
  const byNumber = (a: Row, b: Row) =>
    compareCollectorNumbers(a.printing?.collectorNumber ?? '', b.printing?.collectorNumber ?? '') ||
    (a.printing?.cardName ?? '').localeCompare(b.printing?.cardName ?? '') ||
    (a.item && b.item ? bySetOrder(a.item, b.item) : a.item ? -1 : b.item ? 1 : 0);
  const order: Record<CollectionSort, (a: Row, b: Row) => number> = {
    set: byNumber,
    price: (a, b) => (b.price ?? -1) - (a.price ?? -1) || byNumber(a, b),
    recent: (a, b) => (b.item?.updatedAt ?? '').localeCompare(a.item?.updatedAt ?? '') || byNumber(a, b),
  };
  const sets = groupBySet(rows, (r) => ({ gameId: r.gameId, code: r.printing?.setCode ?? '' }), catalogs.sets);
  for (const g of sets) g.rows.sort(order[prefs.collectionSort] ?? byNumber);
  const collapsed = new Set(prefs.collectionCollapsed);
  const priceSources = [...new Set(items.map((i) => i.gameId))].map((g) => catalogs.prices.get(g)).filter((f) => !!f);

  const lastExport = prefs.lastExportAt ? new Date(prefs.lastExportAt) : null;
  const changedSinceExport = items.some((i) => !lastExport || new Date(i.updatedAt) > lastExport);
  const exportDue = changedSinceExport && (!lastExport || Date.now() - lastExport.getTime() > EXPORT_REMINDER_DAYS * 86_400_000);

  const doExport = async () => {
    setBusy(true);
    try {
      const gameIds = [...new Set(items.map((i) => i.gameId))];
      const data = await exportWorkbook(
        items,
        catalogs.lookup,
        gameIds.map((gameId) => ({ gameId, printings: [...(catalogs.byGame.get(gameId)?.values() ?? [])], sets: catalogs.sets.get(gameId) ?? [] })),
        (item, printing) => {
          const asOf = catalogs.prices.get(item.gameId)?.asOf;
          return { price: itemPrice(item, catalogs.price, printing), asOf: asOf ? formatAsOf(asOf) : undefined };
        },
      );
      downloadBlob(data, `kartensammlung-${new Date().toISOString().slice(0, 10)}.xlsx`, XLSX_TYPE);
      setPrefs({ lastExportAt: new Date().toISOString() });
      setMessage('Excel-Datei erstellt.');
    } finally {
      setBusy(false);
    }
  };

  const changeQty = (item: CollectionItem, delta: number) => {
    if (item.quantity + delta <= 0 && !confirm('Eintrag löschen?')) return;
    service.update(item.itemId, { quantity: item.quantity + delta }).then(onChange);
  };

  const row = (r: Row) => {
    const { item, printing } = r;
    const mover = movers.get(`${r.gameId}|${r.printingId}|${r.finish}`);
    const url = catalogs.price(r.gameId, r.printingId)?.url;
    const languages = catalogs.languages.get(r.gameId) ?? [];
    const language = item && languages.find((l) => l.code === item.language)?.label;
    const expanded = open === r.key;
    return (
      <li key={r.key} class={[item ? '' : 'missing', mover?.strong ? `strong-${trend(mover.delta)}` : ''].join(' ').trim()}>
        <div class="main">
          {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
          <button class="info" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.key)}>
            <strong>{printing?.cardName ?? r.printingId}</strong>
            <small>
              {printing ? printingCode(printing) : ''}
              {item && language ? ` · ${language}` : ''}
              {item ? ` · ${item.condition}` : ''}
              {item && item.quantity > 1 ? ` · ${item.quantity}×` : ''}
              {item?.location ? ` · ${item.location}` : ''}
            </small>
            <span class="line">
              {r.price !== undefined && <span class="price">{formatEur(r.price)}</span>}
              {item?.finish === 'foil' && <em class="tag foil">Foil</em>}
              {item && !item.confirmed && <em class="tag warn">ungeprüft</em>}
            </span>
          </button>
          <MoveCol mover={mover} />
        </div>
        {expanded && (
          <div class="details">
            {item && (
              <div class="qty-row">
                <span>Anzahl</span>
                <div class="qty">
                  <button onClick={() => changeQty(item, -1)} aria-label="weniger">−</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => changeQty(item, 1)} aria-label="mehr">+</button>
                </div>
                {r.price !== undefined && item.quantity > 1 && <small>zusammen {formatEur(r.price * item.quantity)}</small>}
              </div>
            )}
            {item && languages.length > 1 && (
              <div class="chips" role="radiogroup" aria-label="Sprache">
                {languages.map((l) => (
                  <button
                    role="radio"
                    aria-checked={item.language === l.code}
                    class={item.language === l.code ? 'active' : ''}
                    onClick={() => service.update(item.itemId, { language: l.code }).then(onChange)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
            {mover && (
              <small>
                {SIGNED_EUR.format(mover.delta)} je Karte · {basisLabel(mover)}
              </small>
            )}
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
    <section class="collection">
      <header class="title-row">
        <h1>Sammlung</h1>
        <div class="title-actions">
          <div class="segmented view-switch" role="radiogroup" aria-label="Ansicht">
            {(['binder', 'list'] as const).map((v) => (
              <button role="radio" aria-checked={view === v} class={view === v ? 'active' : ''} onClick={() => showView(v)}>
                {v === 'binder' ? 'Binder' : 'Liste'}
              </button>
            ))}
          </div>
          <CloudLine />
          <button class="export-button" disabled={busy || !items.length} onClick={doExport} aria-label="Als Excel exportieren">
            {icon('M12 4v11M7 10l5 5 5-5M5 20h14')}
            Excel
          </button>
        </div>
      </header>
      {exportDue && !account.signedIn && items.length > 0 && (
        <p class="banner">
          {infoIcon}
          <span>{lastExport ? `Letzter Excel-Export: ${lastExport.toLocaleDateString('de-DE')}` : 'Noch nicht als Excel gesichert'}</span>
        </p>
      )}
      {message && <p class="banner">{message}</p>}
      {view === 'binder' && selectedBinder && (
        <BinderView binders={binders} catalogs={catalogs} selected={selectedBinder} onSelect={selectBinder} arriving={arriving.current} />
      )}
      {view === 'list' && <>
      <div class="find">
        <input type="search" enterkeyhint="search" placeholder="Suchen" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button class="sort" aria-haspopup="dialog" onClick={() => setSorting(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Sortieren
        </button>
      </div>
      <label class="check">
        <input type="checkbox" checked={prefs.collectionOwnedOnly} onChange={(e) => setPrefs({ collectionOwnedOnly: e.currentTarget.checked })} />
        Nur meine Karten
      </label>
      {!items.length && prefs.collectionOwnedOnly && (
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 4h10a2 2 0 0 1 2 2v12M6 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
          </svg>
          <strong>Noch keine Karten</strong>
        </div>
      )}
      {q && !rows.length && <p class="muted none">Keine Karte</p>}
      <div class="set-list">
        {sets.map((g) => {
          const stats = setStats.get(g.key);
          const ownedMovers = [...new Map(g.rows.filter((r) => r.item).map((r) => [moverKey(r.item!), movers.get(moverKey(r.item!))])).values()].filter(
            (m): m is Mover => !!m,
          );
          return (
            <SetSection
              key={g.key}
              name={g.name}
              detail={`${stats?.owned.size ?? 0} von ${stats?.total ?? 0}${stats?.value ? ` · ${formatEur(stats.value)}` : ''}`}
              change={groupChange(ownedMovers)}
              open={!collapsed.has(g.key)}
              onToggle={() => setPrefs({ collectionCollapsed: toggled(prefs.collectionCollapsed, g.key) })}
            >
              {g.rows.map(row)}
            </SetSection>
          );
        })}
      </div>
      </>}
      {sorting && (
        <Sheet label="Sortieren" onClose={() => setSorting(false)}>
          <h2>Sortieren</h2>
          <div class="options" role="radiogroup" aria-label="Sortieren nach">
            {SORTS.map((o) => (
              <button
                role="radio"
                aria-checked={prefs.collectionSort === o.value}
                class={prefs.collectionSort === o.value ? 'active' : ''}
                onClick={() => {
                  setPrefs({ collectionSort: o.value });
                  setSorting(false);
                }}
              >
                {o.label}
                {prefs.collectionSort === o.value && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      <footer class="legal">
        ScannR was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games
        does not endorse or sponsor this project. Kartendaten und Bilder: offizielle Riftbound-Kartengalerie.
        {priceSources.map((f) => (
          <>
            {' '}Preise: <a href={f.sourceUrl} target="_blank" rel="noopener">{f.source}</a>-Preisguide (Trendpreis, Near Mint), Stand{' '}
            {formatAsOf(f.asOf)}.
          </>
        ))}
      </footer>
    </section>
  );
}

function icon(d: string) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

const infoIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
);
