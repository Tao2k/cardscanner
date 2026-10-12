import { describe, expect, it } from 'vitest';
import { detectLanguage, hanCount, latinWords } from '../src/core/language';

const LANGS = ['en', 'fr', 'zh-CN'];
const texts = {
  en: 'Abandon [Reaction] (Play any time, even before spells and abilities resolve.) Counter a spell. Return it to its owner\'s hand instead of putting it in their trash.',
  fr: 'Abandon [Réaction] (Jouez à tout moment, même avant la résolution des sorts et capacités.) Contrez un sort. Renvoyez-le dans la main de son propriétaire au lieu de le mettre dans sa défausse.',
  'zh-CN': '遗弃 [反应] 反制一个法术。将其返回其拥有者的手牌，而不是放入其废弃堆。',
};

describe('Spracherkennung', () => {
  it('erkennt Englisch an Wörtern, die nur im englischen Text stehen', () => {
    const ocr = 'Abandon\nReaction Play any time even before spells and\nabilities resolve Counter a spell Return it to its owner hand';
    expect(detectLanguage(ocr, texts, LANGS).lang).toBe('en');
  });

  it('erkennt Französisch auch bei OCR-Fehlern', () => {
    const ocr = 'Abandon\nRéaction Jouez a tout moment mème avant la résolution des s0rts\nContrez un sort Renvoyez-le dans la main';
    expect(detectLanguage(ocr, texts, LANGS).lang).toBe('fr');
  });

  it('erkennt Chinesisch an Han-Zeichen, auch wenn Latin-Reste dabei sind', () => {
    const ocr = '遗弃\n[反应] 反制一个法术 将其返回\nUNL-131/219 Kudos Productions';
    expect(detectLanguage(ocr, texts, LANGS).lang).toBe('zh-CN');
  });

  it('nutzt allgemeine Kartenwörter, wenn der Kartentext fehlt', () => {
    expect(detectLanguage('Deal 3 damage to an enemy unit. Draw a card.', {}, LANGS).lang).toBe('en');
    expect(detectLanguage('Infligez 3 dégâts à une unité ennemie. Piochez une carte.', {}, LANGS).lang).toBe('fr');
  });

  it('gibt bei unlesbarem Text keine Sprache zurück', () => {
    expect(detectLanguage('~~ ## 12 /// ..', texts, LANGS).lang).toBeNull();
    expect(detectLanguage('', texts, LANGS).lang).toBeNull();
  });

  it('zählt Han-Zeichen und Latin-Wörter', () => {
    expect(hanCount('遗弃 abc 反应')).toBe(4);
    expect([...latinWords('Réaction, the UNITÉ ab')]).toEqual(['réaction', 'the', 'unité']);
  });
});
