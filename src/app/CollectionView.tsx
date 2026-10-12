import { useState } from 'preact/hooks';
import type { CollectionService } from '../core/collection';
import { exportWorkbook, importWorkbook } from '../core/excel';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { downloadBlob, printingLabel } from './format';
import { imageIn, nameIn } from '../core/catalog';
import type { Prefs } from './prefs';

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

export function CollectionView({ items, catalogs, service, prefs, setPrefs, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const langLabel = (gameId: string, code: string) => catalogs.languages.get(gameId)?.find((l) => l.code === code)?.label ?? code;
  const q = query.trim().toLowerCase();
  const rows = items
    .map((item) => ({ item, printing: catalogs.lookup(item.gameId, item.printingId) }))
    .filter(({ item, printing }) => !q || `${printing?.cardName} ${printing ? nameIn(printing, item.language) : ''} ${printing?.setCode} ${printing?.collectorNumber} ${item.location}`.toLowerCase().includes(q))
    .sort((a, b) => (b.item.updatedAt).localeCompare(a.item.updatedAt));
  const total = items.reduce((n, i) => n + i.quantity, 0);

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
        gameIds.map((gameId) => ({ gameId, printings: [...(catalogs.byGame.get(gameId)?.values() ?? [])] })),
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
      <input type="search" placeholder="Suchen (Name, Set, Nummer, Lagerort)" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      <ul class="items">
        {rows.slice(0, 300).map(({ item, printing }) => (
          <li key={item.itemId}>
            {printing && <img src={imageIn(printing, item.language).thumbUrl ?? imageIn(printing, item.language).imageUrl} alt="" loading="lazy" />}
            <div class="info">
              <strong>{printing ? printingLabel(printing, item.language) : item.printingId}</strong>
              <small>
                {langLabel(item.gameId, item.language)} · {item.finish === 'foil' ? 'Foil · ' : ''}
                {item.condition}
                {item.location ? ` · ${item.location}` : ''}
                {!item.confirmed ? ' · ungeprüft' : ''}
              </small>
            </div>
            <div class="qty">
              <button onClick={() => changeQty(item, -1)} aria-label="weniger">−</button>
              <span>{item.quantity}</span>
              <button onClick={() => changeQty(item, 1)} aria-label="mehr">+</button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > 300 && <p class="muted">Es werden die 300 zuletzt geänderten Einträge angezeigt. Suche nutzen, um weitere zu finden.</p>}
      <footer class="legal">
        CardScanner was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games
        does not endorse or sponsor this project. Kartendaten und Bilder: offizielle Riftbound-Kartengalerie.
      </footer>
    </section>
  );
}
