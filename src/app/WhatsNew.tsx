import { byKind, CHANGE_KINDS, parseChangelog, unseenChanges, type ChangeEntry, type ChangeItem } from '../core/changelog';
import { Sheet } from './Sheet';

/** Alle Änderungen aus `changelog/*.md`, beim Bauen eingelesen; neueste zuerst. */
export const CHANGELOG = parseChangelog(
  import.meta.glob<string>('../../changelog/*.md', { query: '?raw', import: 'default', eager: true }),
);

const SEEN_KEY = 'cardscanner.changelogSeen';

// Beim Laden des Moduls, bevor die App etwas speichert: Hat dieses Gerät die App schon benutzt?
const returning = (() => {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('cardscanner.') && k !== SEEN_KEY);
  } catch {
    return false;
  }
})();

function loadSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Alle heutigen Änderungen gelten als gesehen. */
export function markChangesSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(CHANGELOG.map((e) => e.id)));
  } catch {
    /* ohne Speicher kommt die Meldung beim nächsten Start erneut */
  }
}

/** Änderungen, die dieses Gerät noch nicht gesehen hat. Eine neue Person sieht keine Meldung. */
export function pendingChanges(): ChangeEntry[] {
  const seen = loadSeen();
  const news = unseenChanges(CHANGELOG, seen, returning);
  if (!seen && !news.length) markChangesSeen();
  return news;
}

const LABEL = Object.fromEntries(CHANGE_KINDS.map((k) => [k.kind, k.label]));

function Points({ items }: { items: ChangeItem[] }) {
  return (
    <ul class="changes">
      {items.map((i) => (
        <li>
          <span class={`tag change-${i.kind}`}>{LABEL[i.kind]}</span>
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

/** Blatt nach einem Update: alle neuen Punkte nach Art geordnet. */
export function WhatsNewSheet({ entries, onClose }: { entries: ChangeEntry[]; onClose: () => void }) {
  const title = `Neu in Version ${__APP_VERSION__}`;
  return (
    <Sheet class="whats-new" label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p class="muted">Das hat sich seit deinem letzten Besuch geändert:</p>
      <Points items={byKind(entries)} />
      <button class="primary" onClick={onClose}>Weiter</button>
    </Sheet>
  );
}

/** Alle bisherigen Änderungen nach Tagen, aus den Einstellungen erreichbar. */
export function ChangelogSheet({ onClose }: { onClose: () => void }) {
  const days = [...new Set(CHANGELOG.map((e) => e.date))];
  return (
    <Sheet class="whats-new" label="Was ist neu" onClose={onClose}>
      <h2>Was ist neu</h2>
      {days.map((d) => (
        <section>
          <h3>{dateLabel(d)}</h3>
          <Points items={byKind(CHANGELOG.filter((e) => e.date === d))} />
        </section>
      ))}
      <button class="primary" onClick={onClose}>Fertig</button>
    </Sheet>
  );
}
