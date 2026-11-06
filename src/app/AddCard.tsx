import { useMemo, useState } from 'preact/hooks';
import type { CollectionService } from '../core/collection';
import { CONDITIONS, type CollectionItem, type Condition, type Finish, type Printing } from '../core/types';
import type { Catalogs } from './App';
import { Sheet } from './Sheet';
import { printingCode } from './format';
import { searchCatalog } from '../core/catalog';
import { finishesOf } from '../core/foil';

interface Props {
  catalogs: Catalogs;
  gameId: string;
  items: CollectionItem[];
  service: CollectionService;
  /** Sprache aus den Einstellungen („auto“ = selbst erkennen); vorgewählt, wenn es sie gibt. */
  language: string;
  /** Schon gewählte Karte (aus Binder oder Liste); sonst beginnt das Blatt mit der Suche. */
  printing?: Printing;
  onAdded(printing: Printing, quantity: number): void;
  onClose(): void;
}

/**
 * Karte von Hand zur Sammlung hinzufügen: im Katalog suchen, Ausführung, Sprache, Zustand und Anzahl wählen.
 * Gespeichert wird wie ein bestätigter Scan, gleiche Exemplare werden zusammengezählt.
 */
export function AddCardSheet({ catalogs, gameId, items, service, language, printing: preset, onAdded, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Printing | undefined>(preset);
  const languages = catalogs.languages.get(gameId) ?? [];
  const [lang, setLang] = useState(() => languages.find((l) => l.code === language)?.code ?? languages[0]?.code ?? 'en');
  const [finish, setFinish] = useState<Finish>('normal');
  const [condition, setCondition] = useState<Condition>('NM');
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  const printings = catalogs.ordered.get(gameId) ?? [];
  const results = useMemo(() => searchCatalog(printings, query), [printings, query]);
  const owned = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of items) if (i.gameId === gameId) count.set(i.printingId, (count.get(i.printingId) ?? 0) + i.quantity);
    return count;
  }, [items, gameId]);

  const choose = (p: Printing) => {
    setChosen(p);
    const finishes = finishesOf(p);
    setFinish(finishes.length === 1 ? finishes[0] : 'normal');
    setQuantity(1);
  };

  const add = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    try {
      await service.addScan({ gameId, printingId: chosen.printingId, language: lang, finish, condition, location: '', confirmed: true, quantity });
      onAdded(chosen, quantity);
    } finally {
      setSaving(false);
    }
  };

  const chips = <T extends string>(label: string, options: { value: T; label: string }[], current: T, pick: (v: T) => void) => (
    <div class="field">
      <span>{label}</span>
      <div class="chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button role="radio" aria-checked={current === o.value} class={current === o.value ? 'active' : ''} onClick={() => pick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (!chosen) {
    return (
      <Sheet class="add-card" label="Karte hinzufügen" onClose={onClose}>
        <h2>Karte hinzufügen</h2>
        <input
          type="search"
          enterkeyhint="search"
          placeholder="Name, Set oder Nummer"
          aria-label="Karte suchen"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        {query.trim() && !results.length && <p class="muted">Keine Karte</p>}
        {results.length > 0 && (
          <ul class="add-results">
            {results.map((p) => (
              <li key={p.printingId}>
                <button onClick={() => choose(p)}>
                  <img src={p.thumbUrl ?? p.imageUrl} alt="" loading="lazy" />
                  <span>
                    <strong>{p.cardName}</strong>
                    <small>
                      {printingCode(p)}
                      {owned.get(p.printingId) ? ` · ${owned.get(p.printingId)}× in der Sammlung` : ''}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    );
  }

  const finishes = finishesOf(chosen);
  const have = owned.get(chosen.printingId) ?? 0;
  return (
    <Sheet class="add-card" label="Karte hinzufügen" onClose={onClose}>
      <div class="add-chosen">
        <img src={chosen.thumbUrl ?? chosen.imageUrl} alt="" />
        <div>
          <h2>{chosen.cardName}</h2>
          <small class="muted">
            {printingCode(chosen)}
            {have ? ` · ${have}× in der Sammlung` : ''}
          </small>
          {!preset && (
            <button class="link" onClick={() => setChosen(undefined)}>
              Andere Karte
            </button>
          )}
        </div>
      </div>
      {finishes.length > 1 &&
        chips(
          'Ausführung',
          finishes.map((f) => ({ value: f, label: f === 'foil' ? 'Foil' : 'Normal' })),
          finish,
          setFinish,
        )}
      {languages.length > 1 &&
        chips(
          'Sprache',
          languages.map((l) => ({ value: l.code, label: l.label })),
          lang,
          setLang,
        )}
      {chips(
        'Zustand',
        CONDITIONS.map((c) => ({ value: c, label: c })),
        condition,
        setCondition,
      )}
      <div class="sheet-qty">
        <span>Anzahl</span>
        <div class="qty">
          <button onClick={() => setQuantity((n) => Math.max(1, n - 1))} disabled={quantity <= 1} aria-label="weniger">
            −
          </button>
          <span aria-live="polite">{quantity}</span>
          <button onClick={() => setQuantity((n) => Math.min(99, n + 1))} aria-label="mehr">
            +
          </button>
        </div>
      </div>
      <button class="primary" disabled={saving} onClick={add}>
        {quantity > 1 ? `${quantity} Karten hinzufügen` : 'Hinzufügen'}
      </button>
    </Sheet>
  );
}
