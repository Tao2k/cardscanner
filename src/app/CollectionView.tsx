import { useState } from 'preact/hooks';
import type { CollectionService } from '../core/collection';
import { exportOrder, exportWorkbook, importWorkbook } from '../core/excel';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { downloadBlob, printingCode } from './format';
import { nameIn } from '../core/catalog';
import { collectionValue, formatAsOf, formatEur, itemPrice } from '../core/prices';
import type { CollectionSort, Prefs } from './prefs';
import { moverKey, type MoverLookup } from '../core/priceHistory';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  service: CollectionService;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  /** Stark gestiegene oder gefallene Drucke (Zeitraum wie im Tab „Preise“). */
  movers: MoverLookup;
  onChange(): void;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_REMINDER_DAYS = 7;
const SORTS: { value: CollectionSort; label: string }[] = [
  { value: 'set', label: 'Set und Sammlernummer' },
  { value: 'recent', label: 'Zuletzt gescannt' },
  { value: 'price', label: 'Preis, teuerste zuerst' },
];

export function CollectionView({ items, catalogs, service, prefs, setPrefs, movers, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sorting, setSorting] = useState(false);
  /** Eintrag, dessen Sprache und Marktplatz-Link aufgeklappt sind. */
  const [open, setOpen] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const rows = items
    .map((item) => ({ item, printing: catalogs.lookup(item.gameId, item.printingId) }))
    .filter(({ item, printing }) => !q || `${printing?.cardName} ${printing ? nameIn(printing, item.language) : ''} ${printing?.setCode} ${printing?.collectorNumber} ${item.location}`.toLowerCase().includes(q))
    .map((row) => ({ ...row, price: itemPrice(row.item, catalogs.price, row.printing) }));
  const bySet = exportOrder(catalogs.lookup, catalogs.sets);
  rows.sort(
    prefs.collectionSort === 'set'
      ? (a, b) => bySet(a.item, b.item)
      : prefs.collectionSort === 'price'
        ? (a, b) => (b.price ?? -1) - (a.price ?? -1) || bySet(a.item, b.item)
        : (a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt),
  );
  const total = items.reduce((n, i) => n + i.quantity, 0);
  const value = collectionValue(items, catalogs.price, catalogs.lookup);
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

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const languages = [...new Set([...catalogs.languages.values()].flat().map((l) => l.code))];
      const { items: imported, errors } = await importWorkbook(await file.arrayBuffer(), (g, id) => !!catalogs.lookup(g, id), languages);
      if (!imported.length) {
        setMessage(`Nichts importiert. ${errors.join(' ')}`);
        return;
      }
      const ok = confirm(
        `${imported.length} Einträge aus „${file.name}“ übernehmen? Die aktuelle Sammlung auf diesem Gerät wird dabei ersetzt.` +
          (errors.length ? `\n\n${errors.length} Zeilen werden übersprungen.` : ''),
      );
      if (!ok) return;
      await service.replaceAll(imported);
      onChange();
      setMessage(`${imported.length} Einträge importiert.${errors.length ? ` Übersprungen: ${errors.join(' ')}` : ''}`);
    } catch (e) {
      setMessage(`Import fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const changeQty = (item: CollectionItem, delta: number) => {
    if (item.quantity + delta <= 0 && !confirm('Eintrag löschen?')) return;
    service.update(item.itemId, { quantity: item.quantity + delta }).then(onChange);
  };

  return (
    <section class="collection">
      <header>
        <h1>Sammlung</h1>
      </header>
      <div class="stats-row">
        <div class="stat">
          <span>Karten</span>
          <strong>{total}</strong>
        </div>
        <div class="stat">
          <span>Einträge</span>
          <strong>{items.length}</strong>
        </div>
        <div class="stat accent">
          <span>Wert</span>
          <strong>{priceSources.length > 0 ? formatEur(value.total) : '–'}</strong>
          {value.unpriced > 0 && priceSources.length > 0 && <small>{value.unpriced} ohne Preis</small>}
        </div>
      </div>
      {exportDue && items.length > 0 && (
        <p class="banner">
          {infoIcon}
          <span>Die Sammlung liegt nur auf diesem Gerät. Exportiere sie regelmäßig als Excel, damit nichts verloren geht.</span>
        </p>
      )}
      <div class="actions">
        <button class="primary" disabled={busy || !items.length} onClick={doExport}>
          {icon('M12 4v11M7 10l5 5 5-5M5 20h14')}
          Excel-Export
        </button>
        <label class={`button ${busy ? 'disabled' : ''}`}>
          {icon('M12 15V4M7 9l5-5 5 5M5 20h14')}
          Excel-Import
          <input
            type="file"
            accept=".xlsx"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) doImport(f);
            }}
          />
        </label>
      </div>
      {message && <p class="banner">{message}</p>}
      {items.length > 0 && (
        <div class="find">
          <input type="search" placeholder="Suchen (Name, Set, Nummer)" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          <button class="sort" aria-haspopup="dialog" onClick={() => setSorting(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Sortieren
          </button>
        </div>
      )}
      {!items.length && (
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 4h10a2 2 0 0 1 2 2v12M6 7h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
          </svg>
          <strong>Noch keine Karten</strong>
          <p>Scanne deine erste Karte oder importiere eine Excel-Datei.</p>
        </div>
      )}
      <ul class="items">
        {rows.slice(0, 300).map(({ item, printing, price }) => {
          const url = catalogs.price(item.gameId, item.printingId)?.url;
          const languages = catalogs.languages.get(item.gameId) ?? [];
          const language = languages.find((l) => l.code === item.language)?.label;
          const expanded = open === item.itemId;
          const mover = movers.get(moverKey(item));
          return (
            <li key={item.itemId}>
              <div class="main">
                {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
                <button class="info" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.itemId)}>
                  <strong>{printing?.cardName ?? item.printingId}</strong>
                  <small>
                    {printing ? `${printingCode(printing)} · ` : ''}
                    {language ? `${language} · ` : ''}
                    {item.condition}
                    {item.location ? ` · ${item.location}` : ''}
                  </small>
                  <span class="line">
                    {price !== undefined && <span class="price">{formatEur(price)}</span>}
                    {mover && (
                      <em class={`tag move ${mover.delta > 0 ? 'up' : 'down'}`} title={mover.delta > 0 ? 'stark gestiegen' : 'stark gefallen'}>
                        {mover.delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(mover.pct * 100))} %
                      </em>
                    )}
                    {item.finish === 'foil' && <em class="tag foil">Foil</em>}
                    {!item.confirmed && <em class="tag warn">ungeprüft</em>}
                  </span>
                  {price !== undefined && item.quantity > 1 && <small>zusammen {formatEur(price * item.quantity)}</small>}
                </button>
                <div class="qty">
                  <button onClick={() => changeQty(item, -1)} aria-label="weniger">−</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => changeQty(item, 1)} aria-label="mehr">+</button>
                </div>
              </div>
              {expanded && (
                <div class="details">
                  {languages.length > 1 && (
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
                  {url && (
                    <a href={url} target="_blank" rel="noopener">
                      Bei Cardmarket ansehen ↗
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > 300 && <p class="muted">Es werden die ersten 300 Einträge angezeigt. Suche nutzen, um weitere zu finden.</p>}
      {sorting && (
        <>
          <div class="backdrop" onClick={() => setSorting(false)} />
          <div class="sheet" role="dialog" aria-label="Sortieren">
            <div class="grabber" />
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
          </div>
        </>
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
