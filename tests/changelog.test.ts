import { describe, expect, it } from 'vitest';
import { byKind, parseChangelog, parseEntry, unseenChanges } from '../src/core/changelog';

describe('changelog', () => {
  it('liest Punkte mit Art und Datum aus dem Dateinamen', () => {
    const e = parseEntry('2026-10-30-update', '# Überschrift\n\n- Neu: Meldung nach Updates\n- behoben:  Absturz \n* Ohne Art\nText dazwischen');
    expect(e.date).toBe('2026-10-30');
    expect(e.items).toEqual([
      { kind: 'neu', text: 'Meldung nach Updates' },
      { kind: 'behoben', text: 'Absturz' },
      { kind: 'verbessert', text: 'Ohne Art' },
    ]);
  });

  it('sortiert neueste zuerst und lässt README und Leeres weg', () => {
    const entries = parseChangelog({
      '/changelog/2026-10-29-a.md': '- Neu: A',
      '/changelog/2026-10-30-b.md': '- Neu: B',
      '/changelog/README.md': '- Neu: Beispiel',
      '/changelog/2026-10-31-leer.md': 'nichts',
    });
    expect(entries.map((e) => e.id)).toEqual(['2026-10-30-b', '2026-10-29-a']);
  });

  const entries = parseChangelog({
    'changelog/2026-10-28-a.md': '- Neu: A',
    'changelog/2026-10-30-b.md': '- Behoben: B',
    'changelog/2026-10-30-c.md': '- Neu: C',
  });

  it('zeigt nur noch nicht gesehene Änderungen', () => {
    expect(unseenChanges(entries, ['2026-10-28-a', '2026-10-30-b'], true).map((e) => e.id)).toEqual(['2026-10-30-c']);
    expect(unseenChanges(entries, entries.map((e) => e.id), true)).toEqual([]);
  });

  it('neue Person sieht nichts, frühere Nutzer einmal den neuesten Tag', () => {
    expect(unseenChanges(entries, null, false)).toEqual([]);
    expect(unseenChanges(entries, null, true).map((e) => e.id)).toEqual(['2026-10-30-c', '2026-10-30-b']);
  });

  it('ordnet nach Neu, Verbessert, Behoben', () => {
    expect(byKind(entries).map((i) => i.text)).toEqual(['C', 'A', 'B']);
  });
});
