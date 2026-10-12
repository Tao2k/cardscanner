import { describe, expect, it } from 'vitest';
import { detectLanguage, hanChars, latinWords, scoreHan } from '../src/core/language';

const LANGS = ['en', 'fr', 'zh-CN'];
const texts = {
  en: 'Abandon [Reaction] (Play any time, even before spells and abilities resolve.) Counter a spell. Return it to its owner’s hand instead of putting it in their trash.',
  // Wie in Riots Galerie: die französische Seite zeigt den englischen Regeltext.
  fr: 'Abandon [Reaction] (Play any time, even before spells and abilities resolve.) Counter a spell. Return it to its owner’s hand instead of putting it in their trash.',
  'zh-CN': '遗弃 [反应] 反制一个法术。将其返回其拥有者的手牌，而不是放入其废弃堆。',
};

/** OCR-Ersatz: liefert je Schrift einen festen Text und merkt sich, was gelesen wurde. */
function reader(latin: string, han = '') {
  const calls: string[] = [];
  const read = async (script: 'latin' | 'han') => {
    calls.push(script);
    return script === 'latin' ? latin : han;
  };
  return { read, calls };
}

describe('Spracherkennung', () => {
  it('erkennt Englisch ohne chinesische OCR', async () => {
    const r = reader('Abandon\nReaction Play any time even before spells and\nabilities resolve Counter a spell Return it to its owner hand');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBe('en');
    expect(r.calls).toEqual(['latin']);
  });

  it('erkennt Englisch trotz OCR-Fehlern und Rauschen', async () => {
    const r = reader('6) our - encemarer 4 Transpositionist R , @: Retum a friendly unit to its. owner\'s hand. You may play a unit with less Might than that unit');
    expect((await detectLanguage(r.read, { en: 'Transpositionist Return a friendly unit to its owner’s hand. You may play a unit with less Might than that unit, ignoring its cost.' }, LANGS)).lang).toBe('en');
  });

  it('erkennt Französisch auch bei OCR-Fehlern', async () => {
    const r = reader('Abandon\nRéaction Jouez a tout moment mème avant la résolution des s0rts\nContrez un sort Renvoyez-le dans la main');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBe('fr');
  });

  it('erkennt Chinesisch über die Zeichen des echten Kartentexts', async () => {
    const r = reader('~ ## UNL-131/219 Kudos', '遗弃\n[反应] 反制一个法术 将其返回');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBe('zh-CN');
    expect(r.calls).toEqual(['latin', 'han']);
  });

  it('lässt sich von erfundenen Han-Zeichen nicht täuschen', async () => {
    const r = reader('~~ ##', '山水火木金土日月星云风雨');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBeNull();
  });

  it('nutzt allgemeine Kartenwörter, wenn der Kartentext fehlt', async () => {
    expect((await detectLanguage(reader('Deal 3 damage to an enemy unit. Draw a card.').read, {}, LANGS)).lang).toBe('en');
    expect((await detectLanguage(reader('Infligez 3 dégâts à une unité ennemie. Piochez une carte.').read, {}, LANGS)).lang).toBe('fr');
  });

  it('gibt bei unlesbarem Text keine Sprache zurück', async () => {
    expect((await detectLanguage(reader('~~ ## 12 /// ..').read, texts, LANGS)).lang).toBeNull();
  });

  it('zählt Han-Zeichen und Latin-Wörter', () => {
    expect(hanChars('遗弃 abc 反应 遗').size).toBe(4);
    expect(scoreHan('遗弃山', texts['zh-CN'])).toBe(2);
    expect([...latinWords('Réaction, the UNITÉ ab')]).toEqual(['réaction', 'the', 'unité']);
  });
});
