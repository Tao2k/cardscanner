import { useMemo, useState } from 'preact/hooks';
import { MAX_ALBUM_NAME, type Album } from '../core/albums';
import { formatEur, priceFor } from '../core/prices';
import type { Printing } from '../core/types';
import type { Catalogs } from './App';
import { albums, type AlbumsState } from './albums';
import { slotKey } from './binder';
import { printingCode } from './format';
import { Sheet } from './Sheet';

/** So viele Treffer zeigt die Suche im Album höchstens. */
const MAX_RESULTS = 40;

/** Chip „+ Album“ am Ende der Binder-Chips. */
export function NewAlbumChip({ onCreated }: { onCreated(album: Album): void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="album-new" onClick={() => setOpen(true)} aria-label="Neues Album">
        {plus}
        Album
      </button>
      {open && (
        <NameSheet
          title="Neues Album"
          action="Erstellen"
          onClose={() => setOpen(false)}
          onSave={async (name) => {
            const album = await albums.create(name);
            setOpen(false);
            if (album) onCreated(album);
          }}
        />
      )}
    </>
  );
}

/** Blatt mit einem Namensfeld (neues Album oder umbenennen), optional mit Löschen. */
function NameSheet({
  title,
  action,
  initial = '',
  onSave,
  onDelete,
  onClose,
}: {
  title: string;
  action: string;
  initial?: string;
  onSave(name: string): Promise<void> | void;
  onDelete?(): void;
  onClose(): void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet label={title} onClose={onClose}>
      <h2>{title}</h2>
      <form
        class="album-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await onSave(name);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Name, z. B. Lieblingskarten" maxLength={MAX_ALBUM_NAME} enterkeyhint="done" required />
        <button type="submit" class="primary" disabled={busy || !name.trim()}>
          {action}
        </button>
      </form>
      {onDelete && (
        <button class="danger-link" onClick={onDelete}>
          Album löschen
        </button>
      )}
    </Sheet>
  );
}

/** Knöpfe unter dem Kopf eines eigenen Albums: Karten suchen und hinzufügen, umbenennen oder löschen. */
export function AlbumToolbar({ album, catalogs, gameId, onDeleted }: { album: Album; catalogs: Catalogs; gameId: string; onDeleted(): void }) {
  const [sheet, setSheet] = useState<'add' | 'edit' | null>(null);
  return (
    <div class="album-toolbar">
      <button class="primary" onClick={() => setSheet('add')}>
        {plus}
        Karten
      </button>
      <button onClick={() => setSheet('edit')} aria-label="Album bearbeiten">
        {pencil}
        Bearbeiten
      </button>
      {sheet === 'add' && <AlbumSearch album={album} catalogs={catalogs} gameId={gameId} onClose={() => setSheet(null)} />}
      {sheet === 'edit' && (
        <NameSheet
          title="Album bearbeiten"
          action="Speichern"
          initial={album.name}
          onClose={() => setSheet(null)}
          onSave={async (name) => {
            await albums.rename(album.id, name);
            setSheet(null);
          }}
          onDelete={() => {
            if (!confirm(`„${album.name}“ löschen? Die Karten bleiben in deiner Sammlung.`)) return;
            setSheet(null);
            albums.remove(album.id);
            onDeleted();
          }}
        />
      )}
    </div>
  );
}

/** Karten fürs Album suchen (Name, Set, Nummer) und mit einem Tipp hinein- oder herausnehmen. */
function AlbumSearch({ album, catalogs, gameId, onClose }: { album: Album; catalogs: Catalogs; gameId: string; onClose(): void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 2) return [];
    const games = [gameId, ...catalogs.games.map((g) => g.gameId).filter((g) => g !== gameId)];
    const hits: { gameId: string; printing: Printing }[] = [];
    for (const g of games) {
      for (const printing of catalogs.ordered.get(g) ?? []) {
        const text = `${printing.cardName} ${printing.setCode} ${printing.collectorNumber} ${printing.setCode}${printing.collectorNumber}`.toLowerCase();
        if (text.includes(q)) hits.push({ gameId: g, printing });
        if (hits.length >= MAX_RESULTS) return hits;
      }
    }
    return hits;
  }, [q, catalogs, gameId]);
  // Aus dem Store, damit Häkchen sofort umspringen
  const current = albums.get(album.id) ?? album;

  return (
    <Sheet class="album-search" label="Karten hinzufügen" onClose={onClose}>
      <h2>{album.name}</h2>
      <input type="search" enterkeyhint="search" placeholder="Karte suchen" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      {q.length >= 2 && !results.length && <p class="muted none">Keine Karte</p>}
      {results.length > 0 && (
        <ol class="items" aria-label="Treffer">
          {results.map(({ gameId: g, printing }) => {
            const key = slotKey(g, printing.printingId);
            const on = current.cards.includes(key);
            const price = priceFor(catalogs.price(g, printing.printingId), printing.finishes?.length === 1 ? printing.finishes[0] : 'normal', printing);
            return (
              <li key={key}>
                <div class="main">
                  <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />
                  <span class="info">
                    <strong>{printing.cardName}</strong>
                    <small>{printingCode(printing)}</small>
                    {price !== undefined && <span class="price">{formatEur(price)}</span>}
                  </span>
                  <button
                    class={`album-toggle icon${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={on ? 'Aus dem Album nehmen' : 'Ins Album'}
                    onClick={() => albums.toggle(album.id, key)}
                  >
                    {on ? check : plus}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p class="muted">{current.cards.length} {current.cards.length === 1 ? 'Karte' : 'Karten'} im Album</p>
    </Sheet>
  );
}

/** Im Blatt einer Karte: in welchen eigenen Alben sie steckt, mit einem Tipp hinein oder heraus; „+ Neues Album“ legt eins mit ihr an. */
export function AlbumPicker({ cardKey, state }: { cardKey: string; state: AlbumsState }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  if (state.status !== 'ready') return null;
  return (
    <div class="album-picker">
      <small class="muted">Alben</small>
      <div class="chips" role="group" aria-label="Alben">
        {state.albums.map((a) => {
          const on = a.cards.includes(cardKey);
          return (
            <button key={a.id} class={on ? 'active' : ''} aria-pressed={on} onClick={() => albums.toggle(a.id, cardKey)}>
              {on && check}
              {a.name}
            </button>
          );
        })}
        {!naming && (
          <button onClick={() => setNaming(true)}>
            {plus}
            Neues Album
          </button>
        )}
      </div>
      {naming && (
        <form
          class="album-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await albums.create(name, [cardKey]);
            setName('');
            setNaming(false);
          }}
        >
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Name des Albums" maxLength={MAX_ALBUM_NAME} enterkeyhint="done" required />
          <button type="submit" class="primary" disabled={!name.trim()}>
            Erstellen
          </button>
        </form>
      )}
    </div>
  );
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);
const plus = svg('M12 5v14M5 12h14');
const check = svg('M5 12.5l4.5 4.5L19 7.5');
const pencil = svg('M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4');
