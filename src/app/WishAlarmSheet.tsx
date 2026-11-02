import { useState } from 'preact/hooks';
import { STRONG_PCT } from '../core/priceHistory';
import { formatEur, parseEur } from '../core/prices';
import type { Printing } from '../core/types';
import type { Wish } from '../core/wishlist';
import { printingCode } from './format';
import { Sheet } from './Sheet';
import { wishlist } from './wishlist';

interface Props {
  wish: Wish;
  printing?: Printing;
  /** Heutiger Preis, falls bekannt. */
  price?: number;
  /** false: Server kann noch keine Zielpreise speichern. */
  targets: boolean;
  onClose(): void;
}

/** Vorschläge für den Zielpreis: so viel unter dem heutigen Preis. */
const STEPS = [0.1, 0.2, 0.3];

const toInput = (n: number) => n.toFixed(2).replace('.', ',');

/** Preisalarm für eine Karte der Wunschliste: Zielpreis setzen oder entfernen. */
export function WishAlarmSheet({ wish, printing, price, targets, onClose }: Props) {
  const [text, setText] = useState(wish.target !== undefined ? toInput(wish.target) : '');
  const value = parseEur(text);
  const save = (target: number | undefined) => {
    wishlist.setTarget(wish.gameId, wish.printingId, target);
    onClose();
  };

  return (
    <Sheet class="wish-alarm" label="Preisalarm" onClose={onClose}>
      <div class="wish-alarm-card">
        {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" />}
        <span class="info">
          <strong>{printing?.cardName ?? wish.printingId}</strong>
          <small>{printing ? printingCode(printing) : ''}</small>
          <span class="price">{price !== undefined ? `Heute ${formatEur(price)}` : 'Noch kein Preis'}</span>
        </span>
      </div>
      <h2>Preisalarm</h2>
      {targets ? (
        <>
          <p class="muted">Du siehst einen Hinweis, sobald die Karte höchstens so viel kostet.</p>
          <form
            class="wish-alarm-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (value !== undefined) save(value);
            }}
          >
            <label class="wish-alarm-input">
              <span class="sr-only">Zielpreis in Euro</span>
              <input
                inputMode="decimal"
                enterkeyhint="done"
                autocomplete="off"
                placeholder={price !== undefined ? toInput(price * 0.8) : '0,00'}
                value={text}
                onInput={(e) => setText(e.currentTarget.value)}
              />
              <span aria-hidden="true">€</span>
            </label>
            <button type="submit" class="primary" disabled={value === undefined}>
              Speichern
            </button>
          </form>
          {price !== undefined && (
            <div class="chips" aria-label="Vorschläge">
              {STEPS.map((step) => {
                const target = Math.max(0.01, Math.round(price * (1 - step) * 100) / 100);
                return (
                  <button key={step} class={value === target ? 'active' : ''} onClick={() => setText(toInput(target))}>
                    −{Math.round(step * 100)} % · {formatEur(target)}
                  </button>
                );
              })}
            </div>
          )}
          {wish.target !== undefined && (
            <button class="link danger wish-alarm-remove" onClick={() => save(undefined)}>
              Zielpreis entfernen
            </button>
          )}
        </>
      ) : (
        <p class="muted">Zielpreise sind auf dem Server noch nicht eingerichtet.</p>
      )}
      <p class="muted wish-alarm-note">
        {wish.target !== undefined || (targets && value !== undefined)
          ? 'Mit Zielpreis meldet ScannR nur das Erreichen des Ziels.'
          : `Ohne Zielpreis meldet ScannR, wenn die Karte ${Math.round(STRONG_PCT * 100)} % oder mehr günstiger wird.`}
      </p>
    </Sheet>
  );
}
