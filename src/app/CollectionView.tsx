import { useState } from 'preact/hooks';
import type { CollectionService } from '../core/collection';
import { exportOrder, exportWorkbook, importWorkbook } from '../core/excel';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { downloadBlob, printingCode } from './format';
import { nameIn } from '../core/catalog';
import { collectionValue, formatAsOf, formatEur, itemPrice } from '../core/prices';
import type { CollectionSort, Prefs } from './prefs';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  service: CollectionService;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  onChange(): void;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_REMINDER_DAYS = 7;
const SORTS: { value: CollectionSort; label: string }[] = [
  { value: 'set', label: 'Set und Sammlernummer' },
  { value: 'recent', label: 'Zuletzt gescannt' },
  { value: 'price', label: 'Preis, teuerste zuerst' },
];

export function CollectionView({ items, catalogs, service, prefs, setPrefs, onChange }: Props) {
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
        <p class="muted">{total} Karten in {items.length} Einträgen</p>
        {priceSources.length > 0 && items.length > 0 && (
          <p class="value">
            Wert: <strong>{formatEur(value.total)}</strong>
            <small class="muted">
              {' '}laut Cardmarket{value.unpriced ? `, ${value.unpriced} Karten ohne Preis` : ''}
            </small>
          </p>
        )}
      </header>
      {exportDue && items.length > 0 && (
        <p class="banner">
          Die Sammlung liegt nur auf diesem Gerät. Exportiere sie regelmäßig als Excel, damit nichts verloren geht.
        </p>
      )}
      <div class="actions">
        <button class="primary" disabled={busy || !items.length} onClick={doExport}>Als Excel exportieren</button>
        <label class={`button ${busy ? 'disabled' : ''}`}>
          Excel importieren
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
      <div class="find">
        <input type="search" placeholder="Suchen (Name, Set, Nummer)" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button class="sort" aria-haspopup="dialog" onClick={() => setSorting(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Sortieren
        </button>
      </div>
      <ul class="items">
        {rows.slice(0, 300).map(({ item, printing, price }) => {
          const url = catalogs.price(item.gameId, item.printingId)?.url;
          const languages = catalogs.languages.get(item.gameId) ?? [];
          const language = languages.find((l) => l.code === item.language)?.label;
          const expanded = open === item.itemId;
          return (
            <li key={item.itemId}>
              <div class="main">
                {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
                <button class="info" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.itemId)}>
                  <strong>{printing?.cardName ?? item.printingId}</strong>
                  <small>
                    {printing ? `${printingCode(printing)} · ` : ''}
                    {language ? `${language} · ` : ''}
                    {item.finish === 'foil' ? 'Foil · ' : ''}
                    {item.condition}
                    {item.location ? ` · ${item.location}` : ''}
                    {!item.confirmed ? ' · ungeprüft' : ''}
                  </small>
                  {price !== undefined && (
                    <span class="price">
                      {formatEur(price)}
                      {item.quantity > 1 && <small> · zusammen {formatEur(price * item.quantity)}</small>}
                    </span>
                  )}
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
                      Bei Cardmarket ansehen
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
