import { describe, expect, it } from 'vitest';
import { detectLanguage, hanChars, latinWords, printedLanguageCode, scoreHan, showsName, textViews } from '../src/core/language';

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
    // Englischer Text, den das chinesische Modell mit ein paar erfundenen Zeichen liest
    const r = reader('~~ ##', 'Deal 3 damage to an enemy unit 山水火 Draw a card 木金土日月');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBeNull();
  });

  it('erkennt Chinesisch auch ohne chinesischen Vergleichstext', async () => {
    const r = reader('Il1 ~ ## the', '当你打出此牌时抽一张牌并造成三点伤害');
    expect((await detectLanguage(r.read, { en: 'Deal 3 damage.' }, LANGS)).lang).toBe('zh-CN');
  });

  it('lässt sich vom Zeichensalat des Latin-Modells auf chinesischem Text nicht täuschen', async () => {
    // Zwei zufällige englische Treffer reichen nicht, wenn das chinesische Modell klar Chinesisch liest
    const r = reader('the IIl you ~~ 1i', '当你打出此牌时抽一张牌');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBe('zh-CN');
  });

  it('nutzt allgemeine Kartenwörter, wenn der Kartentext fehlt', async () => {
    expect((await detectLanguage(reader('Deal 3 damage to an enemy unit. Draw a card.').read, {}, LANGS)).lang).toBe('en');
    expect((await detectLanguage(reader('Infligez 3 dégâts à une unité ennemie. Piochez une carte.').read, {}, LANGS)).lang).toBe('fr');
  });

  it('gibt bei unlesbarem Text keine Sprache zurück', async () => {
    expect((await detectLanguage(reader('~~ ## 12 /// ..').read, texts, LANGS)).lang).toBeNull();
  });

  it('glaubt der Han-OCR nicht, wenn englischer Regeltext der Karte zu lesen ist', async () => {
    // Wenige englische Wörter, dazu Han-Zeichensalat vom Artwork
    const r = reader('Abandon Counter spell', '山水火木金土日月星云雨');
    const guess = await detectLanguage(r.read, texts, LANGS, undefined, { match: () => 0.3, noLatinBelow: 0.08 });
    expect(guess.lang).toBe('en');
    expect(r.calls).toEqual(['latin']);
  });

  it('nimmt Han-Zeichensalat ohne Bezug zum chinesischen Kartentext nicht als Chinesisch', async () => {
    const r = reader('~~ ##', '山水火木金土日月星云雨');
    expect((await detectLanguage(r.read, texts, LANGS)).lang).toBeNull();
  });

  it('erkennt Englisch am Kartennamen, auch zusammengeschrieben (Playful Phantom)', async () => {
    // So las die OCR die englische Playful Phantom: Name ohne Leerzeichen, sonst nur Flavor-Text
    const latin = 'WMIT/ snapow isLES | SPIRIT . M PlayfulPhantom ês oO “My toys break so easily” LA';
    const opts = { match: () => 0, noLatinBelow: 0.08, name: 'Playful Phantom' };
    expect((await detectLanguage(reader(latin, '多 者 于 全 大 玉').read, { en: 'Playful Phantom [Deflect]' }, LANGS, undefined, opts)).lang).toBe('en');
    expect(showsName('Play ful Phan tom', 'Playful Phantom')).toBe(true);
    expect(showsName('the unit', 'Vi')).toBe(false);
  });

  it('liest das Sprachkürzel in der Infozeile (auch auf Runen)', async () => {
    expect(printedLanguageCode('bé ) | ®) BRUNE La (SR e | RAD - R06 - EN »/ Greg Ghielmetti')).toBe('en');
    expect(printedLanguageCode('VEN » 159/166 + EN # Grafit Studio')).toBe('en');
    expect(printedLanguageCode('OGN - 049/298 / Six More Vodka')).toBeNull();
    expect(printedLanguageCode('Deal 3 damage. ENEMY')).toBeNull();
    const r = reader('bé ) | ®) BRUNE La | RAD - R06 - EN »/ Greg', '了 RUMNE 人');
    expect((await detectLanguage(r.read, { en: 'Order Rune' }, LANGS, undefined, { match: () => 0, noLatinBelow: 0.08 })).lang).toBe('en');
  });

  it('liest Querformat-Karten gedreht in beide Richtungen', () => {
    expect(textViews({ attributes: { orientation: 'portrait' } }).map((v) => v.rotate)).toEqual([0]);
    expect(textViews({}).map((v) => v.rotate)).toEqual([0]);
    expect(textViews({ attributes: { orientation: 'landscape' } }).map((v) => v.rotate)).toEqual([270, 90]);
  });

  it('zählt Han-Zeichen und Latin-Wörter', () => {
    expect(hanChars('遗弃 abc 反应 遗').size).toBe(4);
    expect(scoreHan('遗弃山', texts['zh-CN'])).toBe(2);
    expect([...latinWords('Réaction, the UNITÉ ab')]).toEqual(['réaction', 'the', 'unité']);
  });
});
