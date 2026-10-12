import { useState } from 'preact/hooks';
import type { CollectionService } from '../core/collection';
import type { LearningService } from '../core/learning';
import type { CollectionItem, Printing } from '../core/types';
import type { Catalogs } from './App';
import type { Learned } from './recognizer';
import { printingLabel } from './format';
import { imageIn, nameIn } from '../core/catalog';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  service: CollectionService;
  learning: LearningService;
  learned: Learned | null;
  gameId: string;
  onChange(): void;
  onLearn(): void;
}

/**
 * Unsichere Treffer: richtige Karte antippen, um sie zu bestätigen oder zu korrigieren.
 * Jede Bestätigung wird zu einem eigenen Referenzbild, daraus lernt die Erkennung.
 */
export function ReviewView({ items, catalogs, service, learning, learned, gameId, onChange, onLearn }: Props) {
  const [searching, setSearching] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const open = items.filter((i) => !i.confirmed);

  const choose = async (item: CollectionItem, printingId: string) => {
    await service.confirm(item.itemId, printingId);
    await learning.confirmItem(item.itemId, printingId);
    setSearching(null);
    setQuery('');
    onChange();
    onLearn();
  };
  const remove = async (item: CollectionItem) => {
    await service.remove(item.itemId);
    await learning.itemRemoved(item.itemId);
    onChange();
  };
  const reset = async () => {
    if (!confirm('Alles vergessen, was die Erkennung aus deinen Scans gelernt hat?')) return;
    await learning.reset(gameId);
    onLearn();
  };

  const q = query.trim().toLowerCase();
  const results = (item: CollectionItem): Printing[] =>
    q.length < 2
      ? []
      : (catalogs.ordered.get(item.gameId) ?? [])
          .filter((p) => `${p.cardName} ${nameIn(p, item.language)} ${p.setCode} ${p.collectorNumber} ${p.setCode}-${p.collectorNumber}`.toLowerCase().includes(q))
          .slice(0, 12);

  const candidateButton = (item: CollectionItem, p: Printing, first = false) => (
    <button key={p.printingId} class={first ? 'candidate first' : 'candidate'} onClick={() => choose(item, p.printingId)}>
      <img src={imageIn(p, item.language).imageUrl} alt={p.cardName} loading="lazy" />
      <small>{printingLabel(p, item.language)}</small>
    </button>
  );

  return (
    <section class="review">
      <h1>Prüfen</h1>
      {!open.length && <p class="muted">Keine unsicheren Treffer. Alles bestätigt.</p>}
      {open.length > 0 && <p class="muted">Bei diesen Karten war die Erkennung knapp. Tippe auf die richtige Karte, daraus lernt die Erkennung.</p>}
      {open.map((item) => {
        const candidates = [item.printingId, ...(item.alternatives ?? [])]
          .map((id) => catalogs.lookup(item.gameId, id))
          .filter((p) => !!p);
        return (
          <div class="review-item" key={item.itemId}>
            <div class="candidates">{candidates.map((p, i) => candidateButton(item, p, i === 0))}</div>
            {searching === item.itemId && (
              <>
                <input
                  type="search"
                  placeholder="Name oder Nummer, z. B. OGN-042"
                  value={query}
                  autoFocus
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
                <div class="candidates">{results(item).map((p) => candidateButton(item, p))}</div>
              </>
            )}
            <div class="row">
              <small class="muted">×{item.quantity}{item.matchScore ? ` · ${Math.round(item.matchScore * 100)} %` : ''}</small>
              {searching !== item.itemId && <button onClick={() => { setSearching(item.itemId); setQuery(''); }}>Andere Karte suchen</button>}
              <button onClick={() => remove(item)}>Löschen</button>
            </div>
          </div>
        );
      })}
      {learned && (
        <p class="muted learned">
          {learned.userSamples
            ? `Die Erkennung hat ${learned.userSamples} ${learned.userSamples === 1 ? 'Foto' : 'Fotos'} von dir gelernt`
            : 'Die Erkennung hat noch keine Fotos von dir gelernt'}
          {learned.shiftSamples >= 5 ? ' und passt sich an deine Kamera an.' : '.'}
          {learned.userSamples + learned.shiftSamples > 0 && <button class="link" onClick={reset}>Zurücksetzen</button>}
        </p>
      )}
    </section>
  );
}
