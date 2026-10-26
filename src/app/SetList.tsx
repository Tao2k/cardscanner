import type { ComponentChildren } from 'preact';
import { setRanks } from '../core/excel';
import type { Mover } from '../core/priceHistory';
import type { CardSet } from '../core/types';

/** Gemeinsame Bausteine der Kartenlisten in Sammlung und Preise: nach Sets gegliedert, Sets einklappbar. */

export const PCT = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
export const SIGNED_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
export const trend = (delta: number) => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
export const arrow = (delta: number) => (delta > 0 ? '▲' : delta < 0 ? '▼' : '');

export interface SetGroup<T> {
  key: string;
  gameId: string;
  code: string;
  name: string;
  rows: T[];
}

/** Zeilen nach Set gruppieren; Sets in derselben Reihenfolge wie im Excel-Export (nach Erscheinen). */
export function groupBySet<T>(rows: T[], setOf: (row: T) => { gameId: string; code: string }, sets: Map<string, CardSet[]>): SetGroup<T>[] {
  const groups = new Map<string, SetGroup<T>>();
  for (const row of rows) {
    const { gameId, code } = setOf(row);
    const key = `${gameId}|${code}`;
    let group = groups.get(key);
    if (!group) {
      const name = sets.get(gameId)?.find((s) => s.code === code)?.name ?? (code || 'Ohne Set');
      groups.set(key, (group = { key, gameId, code, name, rows: [] }));
    }
    group.rows.push(row);
  }
  const ranks = new Map([...sets].map(([gameId, list]) => [gameId, setRanks(list)]));
  const rankOf = (g: SetGroup<T>) => ranks.get(g.gameId)?.get(g.code) ?? Number.MAX_SAFE_INTEGER;
  return [...groups.values()].sort((a, b) => a.gameId.localeCompare(b.gameId) || rankOf(a) - rankOf(b) || a.code.localeCompare(b.code));
}

/** Änderung (Anteil) einer Gruppe von Karten, gewichtet mit der Stückzahl; undefined ohne Vergleichspreis. */
export function groupChange(movers: Mover[]): number | undefined {
  const from = movers.reduce((n, m) => n + m.from * m.quantity, 0);
  const to = movers.reduce((n, m) => n + m.to * m.quantity, 0);
  return from > 0 ? (Math.round((to - from) * 100) / 100) / from : undefined;
}

interface SetSectionProps {
  name: string;
  /** z. B. „12 Karten · 103,33 €“ */
  detail: string;
  change?: number;
  open: boolean;
  onToggle(): void;
  children: ComponentChildren;
}

export function SetSection({ name, detail, change, open, onToggle, children }: SetSectionProps) {
  return (
    <div class="set-group">
      <button class="set-head" aria-expanded={open} onClick={onToggle}>
        <svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="set-name">
          <strong>{name}</strong>
          <small class="muted">{detail}</small>
        </span>
        {change !== undefined && <span class={`set-change ${trend(change)}`}>{PCT.format(change)}</span>}
      </button>
      {open && <ol class="items movers">{children}</ol>}
    </div>
  );
}

/** Prozent-Pille (kräftig bei starker Änderung) und Änderung in € rechts in einer Kartenzeile. */
export function MoveCol({ mover }: { mover?: Mover }) {
  if (!mover) return null;
  return (
    <span class="move-col">
      <span class={`delta ${trend(mover.delta)}${mover.strong ? ' strong' : ''}`}>
        {mover.strong && `${arrow(mover.delta)} `}
        {PCT.format(mover.pct)}
      </span>
      <small class={trend(mover.delta)}>{SIGNED_EUR.format(mover.delta)}</small>
    </span>
  );
}

/** Eingeklappte Sets umschalten (Liste von Schlüsseln „gameId|setCode“ in den Einstellungen). */
export function toggled(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}
