import { describe, expect, it } from 'vitest';
import { classify, learnConditionScale, scaleThresholds } from '../src/core/condition';
import { detectLanguage } from '../src/core/language';
import { judgeStats, type ScanStats } from '../src/app/stats';

describe('Lernen aus Korrekturen', () => {
  it('lernt, den Zustand strenger zu schätzen', () => {
    // Geschätzt NM, du sagst LP: Schwellen werden strenger
    const feedback = [
      { edge: 0.003, corner: 0.03, condition: 'LP' as const },
      { edge: 0.0035, corner: 0.035, condition: 'LP' as const },
      { edge: 0.0005, corner: 0.002, condition: 'NM' as const },
    ];
    const scale = learnConditionScale(feedback);
    expect(scale).toBeLessThan(1);
    for (const f of feedback) expect(classify(f.edge, f.corner, scaleThresholds(scale))).toBe(f.condition);
    expect(learnConditionScale([])).toBe(1);
  });

  it('nimmt Chinesisch an, wenn kein englischer Text zu sehen ist und die chinesische Erkennung nichts liefert', async () => {
    const read = async (script: 'latin' | 'han') => (script === 'latin' ? 'ii ~ zx 7 qq' : '');
    const texts = { en: 'Sprite Fountain At the start of your turn, draw a card.' };
    const langs = ['en', 'fr', 'zh-CN'];
    expect((await detectLanguage(read, texts, langs)).lang).toBeNull();
    const guess = await detectLanguage(read, texts, langs, undefined, { match: () => 0.01, noLatinBelow: 0.08 });
    expect(guess).toMatchObject({ lang: 'zh-CN', reason: 'no-latin' });
    // Englischer Text passt zur Karte: nicht chinesisch, sondern Englisch
    expect((await detectLanguage(read, texts, langs, undefined, { match: () => 0.4, noLatinBelow: 0.08 })).lang).toBe('en');
    // Hat die chinesische Erkennung gelesen und nichts Chinesisches gefunden, ist es nicht automatisch Chinesisch
    const readBoth = async (script: 'latin' | 'han') => (script === 'latin' ? 'ii ~ zx 7 qq' : 'ii 7 zx');
    expect((await detectLanguage(readBoth, texts, langs, undefined, { match: () => 0.01, noLatinBelow: 0.08 })).lang).toBeNull();
    // Zeitüberschreitung: dann doch
    const timedOut = { match: () => 0.01, noLatinBelow: 0.08, hanUnavailable: () => true };
    expect((await detectLanguage(readBoth, texts, langs, undefined, timedOut)).reason).toBe('no-latin');
  });

  it('zählt jeden Scan einmal, eine falsche Karte ersetzt kleinere Fehler', () => {
    let s: ScanStats = { auto: 10, wrong: 0, right: 0, foilWrong: 0, languageWrong: 0, conditionWrong: 0, asked: 0 };
    const apply = (prev: Parameters<typeof judgeStats>[0], next: Parameters<typeof judgeStats>[1]) => {
      const r = judgeStats(prev, next);
      if (r.patch) s = { ...s, ...r.patch(s) };
      return r.judged;
    };
    let j = apply(undefined, 'right');
    j = apply(j, 'language');
    expect(s).toMatchObject({ right: 0, languageWrong: 1 });
    j = apply(j, 'foil');
    expect(s).toMatchObject({ languageWrong: 1, foilWrong: 0 });
    j = apply(j, 'card');
    expect(s).toMatchObject({ languageWrong: 0, wrong: 1 });
    expect(apply(j, 'right')).toBe('card');
  });
});
