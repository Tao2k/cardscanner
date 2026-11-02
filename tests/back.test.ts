import { beforeAll, describe, expect, it, vi } from 'vitest';

/** Browserverlauf wie im Browser: back() meldet popstate erst später (asynchron). */
const entries: unknown[] = [null];
let index = 0;
const listeners: (() => void)[] = [];
beforeAll(() => {
  vi.stubGlobal('history', {
    pushState(state: unknown) {
      entries.splice(index + 1, Infinity, state);
      index++;
    },
    back() {
      setTimeout(() => {
        if (index === 0) return;
        index--;
        listeners.forEach((l) => l());
      }, 0);
    },
  });
  vi.stubGlobal('addEventListener', (type: string, l: () => void) => type === 'popstate' && listeners.push(l));
});

const { openLayer } = await import('../src/app/back');
const tick = () => new Promise((r) => setTimeout(r, 1));
/** Zurück-Taste drücken. */
const pressBack = async () => {
  history.back();
  await tick();
};

describe('Zurück-Taste', () => {
  it('schließt die oberste Ebene und hält den Verlauf sauber', async () => {
    const closed: string[] = [];
    openLayer(() => void closed.push('tab'));
    openLayer(() => void closed.push('blatt'));
    expect(index).toBe(2);
    await pressBack();
    expect(closed).toEqual(['blatt']);
    await pressBack();
    expect(closed).toEqual(['blatt', 'tab']);
    expect(index).toBe(0);
  });

  it('nimmt den Eintrag heraus, wenn man die Ebene selbst schließt, auch wenn gleich die nächste aufgeht', async () => {
    const closed: string[] = [];
    const releaseA = openLayer(() => void closed.push('a'));
    releaseA();
    openLayer(() => void closed.push('b'));
    await tick();
    expect(index).toBe(1);
    await pressBack();
    expect(closed).toEqual(['b']);
    expect(index).toBe(0);
  });

  it('lässt ein Blatt mit Pflichtfrage offen', async () => {
    let asked = 0;
    const release = openLayer(() => {
      asked++;
      return false;
    });
    await pressBack();
    expect(asked).toBe(1);
    expect(index).toBe(1);
    release();
    await tick();
    expect(index).toBe(0);
  });
});
