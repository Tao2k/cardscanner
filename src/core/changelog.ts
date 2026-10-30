/**
 * Änderungen für die Meldung „Neu in Version …“ nach einem Update.
 *
 * Jede Änderung ist eine eigene Datei in `changelog/` (Name `JJJJ-MM-TT-stichwort.md`), damit sich
 * gleichzeitige Pull Requests nicht in die Quere kommen. Der Dateiname ist die feste Kennung: Die App
 * merkt sich, welche Kennungen sie schon gezeigt hat, und zeigt nach einem Update nur die neuen.
 * Die Versionsnummer taugt dafür nicht, sie entsteht erst beim Mergen (vite.config.ts).
 */
export type ChangeKind = 'neu' | 'verbessert' | 'behoben';

export interface ChangeItem {
  kind: ChangeKind;
  text: string;
}

export interface ChangeEntry {
  /** Dateiname ohne `.md`, z. B. „2026-10-30-update-meldung“. */
  id: string;
  /** JJJJ-MM-TT aus dem Dateinamen (leer, wenn er nicht mit einem Datum beginnt). */
  date: string;
  items: ChangeItem[];
}

export const CHANGE_KINDS: { kind: ChangeKind; label: string }[] = [
  { kind: 'neu', label: 'Neu' },
  { kind: 'verbessert', label: 'Verbessert' },
  { kind: 'behoben', label: 'Behoben' },
];

const POINT = /^[-*]\s+(?:(neu|verbessert|behoben)\s*:\s*)?(.+)$/i;

/** Liest eine Datei: jede Zeile „- Neu: …“, „- Verbessert: …“ oder „- Behoben: …“ ist ein Punkt, alles andere zählt nicht. */
export function parseEntry(id: string, text: string): ChangeEntry {
  const items: ChangeItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = POINT.exec(line.trim());
    if (m) items.push({ kind: (m[1]?.toLowerCase() as ChangeKind | undefined) ?? 'verbessert', text: m[2].trim() });
  }
  const date = /^\d{4}-\d{2}-\d{2}/.exec(id)?.[0] ?? '';
  return { id, date, items };
}

/** Alle Dateien (Pfad → Inhalt), neueste zuerst; README und leere Dateien fallen weg. */
export function parseChangelog(files: Record<string, string>): ChangeEntry[] {
  return Object.entries(files)
    .map(([path, text]) => parseEntry(path.split('/').pop()!.replace(/\.md$/, ''), text))
    .filter((e) => e.date && e.items.length)
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * Was nach dem Start zu zeigen ist. `seen` = schon gezeigte Kennungen, null = noch nie etwas gemerkt.
 * Ohne Merkliste sieht eine neue Person nichts; wer die App schon vor der Update-Meldung benutzt hat
 * (`returning`), sieht einmal die Änderungen vom neuesten Tag.
 */
export function unseenChanges(entries: ChangeEntry[], seen: string[] | null, returning: boolean): ChangeEntry[] {
  if (seen) {
    const known = new Set(seen);
    return entries.filter((e) => !known.has(e.id));
  }
  if (!returning || !entries.length) return [];
  return entries.filter((e) => e.date === entries[0].date);
}

/** Alle Punkte nach Art geordnet (Neu, Verbessert, Behoben), innerhalb einer Art neueste zuerst. */
export function byKind(entries: ChangeEntry[]): ChangeItem[] {
  const items = entries.flatMap((e) => e.items);
  return CHANGE_KINDS.flatMap(({ kind }) => items.filter((i) => i.kind === kind));
}
