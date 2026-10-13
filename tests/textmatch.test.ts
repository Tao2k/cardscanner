import { describe, expect, it } from 'vitest';
import { buildTextIndex, decide, matchText, readCollectorNumber, textWinner } from '../src/core/textmatch';
import type { Printing } from '../src/core/types';

const card = (id: string, name: string, text: string, number: string, extra: Partial<Printing> = {}): Printing =>
  ({ printingId: id, cardName: name, setCode: 'OGN', collectorNumber: number, variant: 'normal', imageUrl: '', texts: { en: `${name} ${text}` }, ...extra }) as Printing;

const printings = [
  card('a', 'Jinx, Loose Cannon', 'When you play this, deal 2 damage to an enemy unit. Exhaust a friendly gear.', '001'),
  card('a2', 'Jinx, Loose Cannon', 'When you play this, deal 2 damage to an enemy unit. Exhaust a friendly gear.', '001a', { variant: 'alt_art' }),
  card('b', 'Sprite Fountain', 'At the start of your turn, draw a card. Your units have +1 might.', '078'),
  card('c', 'Fury Rune', '', '200'),
  card('d', 'Garen, Might of Demacia', 'Your other units have +1 might while you control a battlefield.', '102', { texts: { en: 'Garen, Might of Demacia Your other units have +1 might while you control a battlefield.', 'zh-CN': '盖伦 德玛西亚之力 你的其他单位' } }),
];
const index = buildTextIndex(printings);

describe('Erkennung am Text', () => {
  it('fasst Drucke mit gleichem Text zusammen', () => {
    expect(index.groups.length).toBe(4);
    expect(index.groupOf[0]).toBe(index.groupOf[1]);
  });

  it('erkennt die Karte trotz Lesefehlern', () => {
    const m = matchText(index, { latin: 'Spr1te Fountian\nAt tbe start of your turn, draw a card. Your unts have +1 mlght.' });
    const w = textWinner(m);
    expect(w && index.groups[w.group].members).toEqual([2]);
  });

  it('erkennt chinesischen Text', () => {
    const w = textWinner(matchText(index, { han: '盖伦 德玛西亚之力 你的其他单位' }));
    expect(w && index.groups[w.group].members).toEqual([4]);
  });

  it('ist bei Zeichensalat nicht eindeutig', () => {
    expect(textWinner(matchText(index, { latin: 'ii ~~ ._ ae ss' }))).toBeNull();
  });

  it('liest die Sammlernummer', () => {
    expect(readCollectorNumber('OGN • 001a/298 Illus')).toBe('1a');
    expect(readCollectorNumber('UNL 229* / 219')).toBe('229*');
    expect(readCollectorNumber('kein Code')).toBeNull();
  });

  const jinx = matchText(index, { latin: 'Jinx, Loose Cannon When you play this, deal 2 damage to an enemy unit. Exhaust a friendly gear.' });

  it('speichert bei unsicherem Bild, wenn der Text eindeutig ist', () => {
    const image = [{ index: 2, score: 0.8 }, { index: 0, score: 0.79 }, { index: 1, score: 0.7 }];
    expect(decide(index, image, false, jinx, 4)).toEqual({ action: 'save', index: 0, via: 'text' });
  });

  it('fragt bei Varianten ohne klares Bild nur nach den Varianten', () => {
    const image = [{ index: 0, score: 0.8 }, { index: 1, score: 0.79 }];
    expect(decide(index, image, false, jinx, 4)).toEqual({ action: 'ask', candidates: [0, 1], reason: 'unsure' });
    expect(decide(index, image, false, { ...jinx, collector: '1a' }, 4)).toEqual({ action: 'save', index: 1, via: 'text' });
  });

  it('fragt nach, wenn sicheres Bild und eindeutiger Text verschiedene Karten sagen', () => {
    const image = [{ index: 2, score: 0.9 }, { index: 3, score: 0.6 }];
    expect(decide(index, image, true, jinx, 4)).toMatchObject({ action: 'ask', reason: 'conflict' });
    expect(decide(index, image, true, null, 4)).toEqual({ action: 'save', index: 2, via: 'image' });
  });
});
