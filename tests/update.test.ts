import { describe, expect, it } from 'vitest';
import { UpdateScheduler } from '../src/core/update';

function setup(found = false) {
  let t = 0;
  const log: string[] = [];
  const s = new UpdateScheduler(
    {
      check: async () => {
        log.push('check');
        return found;
      },
      reload: () => log.push('reload'),
      now: () => t,
    },
    { minIntervalMs: 60_000 },
  );
  const pending: boolean[] = [];
  s.onPendingChange = (p) => pending.push(p);
  return { s, log, pending, advance: (ms: number) => (t += ms) };
}

describe('App-Updates', () => {
  it('sucht beim Start und beim Zurückkehren, aber nicht ständig', async () => {
    const { s, log, advance } = setup();
    await s.maybeCheck();
    s.setVisible(false);
    advance(10_000);
    s.setVisible(true); // zu kurz her
    advance(60_000);
    s.setVisible(false);
    s.setVisible(true);
    await Promise.resolve();
    expect(log).toEqual(['check', 'check']);
  });

  it('sucht nicht, während gescannt wird, und holt es danach nach', async () => {
    const { s, log } = setup();
    s.setBusy(true);
    expect(await s.maybeCheck()).toBe(false);
    expect(log).toEqual([]);
    s.setBusy(false);
    await Promise.resolve();
    expect(log).toEqual(['check']);
  });

  it('sucht von Hand auch kurz nach der letzten Suche und meldet das Ergebnis', async () => {
    const { s, log } = setup(true);
    await s.maybeCheck();
    expect(await s.maybeCheck()).toBe(false);
    expect(await s.maybeCheck(true)).toBe(true);
    expect(log).toEqual(['check', 'check']);
  });

  it('lädt sofort neu, wenn gerade nichts passiert', () => {
    const { s, log, pending } = setup();
    s.activated();
    expect(log).toEqual(['reload']);
    expect(pending).toEqual([]);
  });

  it('lädt nie mitten im Scan neu, sondern zeigt den Hinweis', () => {
    const { s, log, pending } = setup();
    s.setBusy(true);
    s.activated();
    expect(log).toEqual([]);
    expect(pending).toEqual([true]);
    // Scan beendet: Hinweis bleibt, kein überraschendes Neuladen
    s.setBusy(false);
    expect(log).toEqual([]);
    s.applyNow();
    expect(log).toEqual(['reload']);
  });

  it('übernimmt die neue Version, sobald die App in den Hintergrund geht oder zurückkommt', () => {
    const { s, log } = setup();
    s.setBusy(true);
    s.activated();
    s.setVisible(false); // Scan läuft noch
    expect(log).toEqual([]);
    s.setBusy(false);
    s.setVisible(true);
    expect(log).toEqual(['reload']);
  });

  it('lädt nicht neu, während Karten in den Binder fliegen', async () => {
    const { s, log, pending } = setup();
    const release = s.hold();
    // Die neue Version wird mitten in der Animation aktiv: kein Neuladen, das sie abbricht
    s.activated();
    expect(log).toEqual([]);
    expect(pending).toEqual([true]);
    release();
    release();
    expect(log).toEqual([]);
    s.applyNow();
    expect(log).toEqual(['reload']);
  });

  it('sucht erst wieder, wenn alle Sperren frei sind', async () => {
    const { s, log } = setup();
    const a = s.hold();
    const b = s.hold();
    expect(await s.maybeCheck()).toBe(false);
    a();
    await Promise.resolve();
    expect(log).toEqual([]);
    b();
    await Promise.resolve();
    expect(log).toEqual(['check']);
  });

  it('übersteht fehlendes Netz', async () => {
    const s = new UpdateScheduler({ check: () => Promise.reject(new Error('offline')), reload: () => {}, now: () => 0 });
    expect(await s.maybeCheck()).toBe(false);
  });
});
