import type { CollectionService } from '../core/collection';
import type { CollectionItem } from '../core/types';
import type { Catalogs } from './App';
import { printingLabel } from './format';
import { imageIn } from '../core/catalog';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  service: CollectionService;
  onChange(): void;
}

/** Unsichere Treffer: richtige Karte antippen, um sie zu bestätigen oder zu korrigieren. */
export function ReviewView({ items, catalogs, service, onChange }: Props) {
  const open = items.filter((i) => !i.confirmed);
  if (!open.length) {
    return (
      <section class="review">
        <h1>Prüfen</h1>
        <p class="muted">Keine unsicheren Treffer. Alles bestätigt.</p>
      </section>
    );
  }
  const choose = async (item: CollectionItem, printingId: string) => {
    await service.confirm(item.itemId, printingId);
    onChange();
  };
  return (
    <section class="review">
      <h1>Prüfen</h1>
      <p class="muted">Bei diesen Karten war die Erkennung knapp. Tippe auf die richtige Karte.</p>
      {open.map((item) => {
        const candidates = [item.printingId, ...(item.alternatives ?? [])]
          .map((id) => catalogs.lookup(item.gameId, id))
          .filter((p) => !!p);
        return (
          <div class="review-item" key={item.itemId}>
            <div class="candidates">
              {candidates.map((p, i) => (
                <button key={p.printingId} class={i === 0 ? 'candidate first' : 'candidate'} onClick={() => choose(item, p.printingId)}>
                  <img src={imageIn(p, item.language).imageUrl} alt={p.cardName} loading="lazy" />
                  <small>{printingLabel(p, item.language)}</small>
                </button>
              ))}
            </div>
            <div class="row">
              <small class="muted">×{item.quantity}{item.matchScore ? ` · ${Math.round(item.matchScore * 100)} %` : ''}</small>
              <button onClick={() => service.remove(item.itemId).then(onChange)}>Keine davon, löschen</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
