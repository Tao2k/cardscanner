/**
 * Bestimmt die Drucksprache einer Karte aus OCR-Text.
 *
 * Der Druck ist zu diesem Zeitpunkt schon über das Bild erkannt; wir kennen also Name und
 * Regeltext der Karte in jeder Sprache und prüfen nur, welche Fassung der gelesene Text trifft:
 * - Englisch/Französisch: Wörter, die nur in einer der beiden Fassungen vorkommen.
 * - Chinesisch: Han-Zeichen, die tatsächlich im chinesischen Text dieser Karte stehen.
 *   (Die OCR erfindet auf Bildern gern Han-Zeichen; die treffen den echten Text aber kaum.)
 */

export interface LanguageGuess {
  /** null = nicht eindeutig; dann entscheidet der Aufrufer (z. B. zuletzt erkannte Sprache). */
  lang: string | null;
  scores: Record<string, number>;
  /** Woran die Sprache erkannt wurde. */
  reason?: 'words' | 'han' | 'no-latin' | 'only';
}

export interface DetectOptions {
  /** Mindestanzahl passender Han-Zeichen für Chinesisch. */
  minHan: number;
  /** Mindestanzahl sprachtypischer Wörter für eine Latin-Sprache. */
  minWords: number;
}

export const DEFAULT_DETECT: DetectOptions = { minHan: 4, minWords: 2 };

/**
 * Passt der lateinisch gelesene Text kaum zum englischen Kartentext (latinMatch unter dieser Schwelle) und
 * stehen keine sprachtypischen Wörter darin, ist der Druck nicht lateinisch, also chinesisch. Greift, wenn
 * die chinesische Texterkennung nichts liefert (auf dem Handy z. B. zu langsam). Kalibriert mit
 * `npm run eval -- --text 300` (Oktober 2026): Chinesische Drucke lagen alle bei 0, englische zu 4 % darunter
 * (meist Karten mit fast keinem Text). Ohne chinesische Texterkennung wurden so 100 % der chinesischen Drucke
 * erkannt, 1,3 % der englischen fälschlich als chinesisch. Lernt aus deinen Sprachkorrekturen (learnThreshold).
 */
export const NO_LATIN_BELOW = 0.08;

/**
 * Ausschlusskriterium für Chinesisch: Passt der lateinisch gelesene Text mindestens so gut zum englischen
 * Kartentext, ist englischer Regeltext zu sehen, und den tragen chinesische Drucke nicht. Dann zählt die
 * chinesische Texterkennung nicht mehr (die erfindet auf Bildern gern Han-Zeichen). Kalibriert mit
 * `npm run eval -- --langcheck` (Oktober 2026), siehe PR „Falsche Chinesisch-Erkennung“.
 */
export const LATIN_PROOF = 0.2;

/**
 * Sprache aus dem Kartenbild: Gibt es für den Druck eigene Bilder je Sprache (Riot hat z. B. für
 * chinesische Drucke eigene Scans), gewinnt die Sprache, deren Bild dem Foto klar am ähnlichsten ist.
 * Liefert null, wenn es nur ein Bild gibt oder der Abstand zu klein ist.
 */
export function languageFromImage(scores: { lang: string; score: number }[], minMargin = IMAGE_LANGUAGE_MARGIN): string | null {
  const best = new Map<string, number>();
  for (const s of scores) best.set(s.lang, Math.max(best.get(s.lang) ?? -Infinity, s.score));
  if (best.size < 2) return null;
  const ranked = [...best].sort((a, b) => b[1] - a[1]);
  return ranked[0][1] - ranked[1][1] >= minMargin ? ranked[0][0] : null;
}

/**
 * Mindestabstand der Bildähnlichkeit zwischen zwei Sprachfassungen. Gemessen (eval --ocr): die Bilder
 * unterscheiden sich oft nur im Text, englische Fotos liegen in 10 % der Fälle bis 0,03 näher am
 * chinesischen Bild. Deshalb nur als Notlösung, wenn der gelesene Text nicht eindeutig ist.
 */
export const IMAGE_LANGUAGE_MARGIN = 0.04;

/**
 * Chinesisch auch ohne passenden Vergleichstext: Viele verschiedene Han-Zeichen, die gegenüber
 * lateinischen Buchstaben überwiegen, entstehen kaum durch OCR-Fehler auf englischem Text.
 */
export function looksHan(ocrText: string, minDistinct = 8): boolean {
  const han = hanChars(ocrText).size;
  const latinLetters = (ocrText.match(/\p{Script=Latin}/gu) ?? []).length;
  return han >= minDistinct && han * 2 > latinLetters;
}

/**
 * Steht der englische Kartenname im gelesenen Text (auch zusammengeschrieben, z. B. „PlayfulPhantom“)?
 * Chinesische Drucke tragen den chinesischen Namen, das ist also ebenfalls ein Ausschlusskriterium.
 * Erst ab 6 Buchstaben, kürzere Namen kommen zu leicht zufällig vor.
 */
export function showsName(ocrText: string, name: string): boolean {
  const letters = (t: string) => t.normalize('NFC').toLowerCase().replace(/[^\p{Script=Latin}]/gu, '');
  const n = letters(name);
  return n.length >= 6 && letters(ocrText).includes(n);
}

/**
 * Sprachkürzel in der Infozeile neuerer Drucke, direkt hinter der Sammlernummer, z. B. „159/166 · EN“ oder
 * „RAD · R06 · EN“. Das ist auch auf Runen lesbar, die sonst kaum Text haben.
 */
export function printedLanguageCode(ocrText: string): string | null {
  const m = ocrText.match(/(?:\d{1,3}[a-z*]?\s*\/\s*\d{2,3}|\b[A-Z]{3}\s*\W\s*R\d{2})\s*[^\p{L}\d\s]{0,3}\s*(EN|FR)\b/u);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Bereich der Karte mit Name und Regeltext (Anteile von Breite/Höhe). Nur dieser Teil wird gelesen;
 * auf dem Artwork liefert die OCR nur Rauschen.
 */
export const TEXT_REGION = { left: 0.04, top: 0.5, right: 0.96, bottom: 0.97 };

/** Ganze Karte ohne den äußersten Rand. */
export const FULL_REGION = { left: 0.03, top: 0.03, right: 0.97, bottom: 0.97 };

/**
 * Wie das Kamerabild für die Texterkennung gelesen wird: erst um `rotate` Grad im Uhrzeigersinn drehen,
 * dann `region` ausschneiden.
 */
export interface TextView {
  rotate: 0 | 90 | 270;
  region: typeof TEXT_REGION;
}

/** Querformat-Karten wie Battlefields (Riot: orientation ≠ portrait). */
export function isLandscape(printing: { attributes?: Record<string, unknown> }): boolean {
  const o = printing.attributes?.orientation;
  return typeof o === 'string' && o !== '' && o !== 'portrait';
}

/**
 * Ansichten für die Spracherkennung. Querformat-Karten liegen hochkant im Zielrahmen, ihr Text läuft also
 * senkrecht; so gelesen liefert die OCR nur Zeichensalat (früher als „kein englischer Text“ → Chinesisch
 * gewertet). Deshalb zurückdrehen, in beide Richtungen, weil die Karte mal so, mal andersherum liegt, und die
 * ganze Karte lesen. Der Text beider Ansichten wird aneinandergehängt; die falsch gedrehte trägt nur Rauschen bei.
 */
export function textViews(printing: { attributes?: Record<string, unknown> }): TextView[] {
  if (!isLandscape(printing)) return [{ rotate: 0, region: TEXT_REGION }];
  return [
    { rotate: 270, region: FULL_REGION },
    { rotate: 90, region: FULL_REGION },
  ];
}

/**
 * Typische Wörter je Sprache auf Kartentexten. Wichtig für Französisch: Riots Galerie zeigt auch
 * auf der französischen Seite den englischen Regeltext, es gibt also keinen französischen
 * Vergleichstext. Wörter, die in beiden Sprachen vorkommen (z. B. „main“), fehlen bewusst.
 */
const COMMON_WORDS: Record<string, string[]> = {
  en: ['the', 'you', 'your', 'and', 'this', 'that', 'with', 'when', 'each', 'play', 'card', 'cards', 'unit', 'units', 'may', 'its', 'from', 'into', 'enemy', 'friendly', 'turn', 'draw', 'deal', 'damage', 'might', 'return', 'hand', 'any', 'time', 'before', 'after', 'other', 'ready', 'exhaust', 'kill', 'gain', 'start', 'then', 'all', 'one', 'two', 'three', 'here', 'there', 'have', 'has', 'can', 'instead', 'until', 'battlefield', 'spell', 'spells', 'counter', 'owner', 'controller', 'choose', 'look', 'top', 'deck'],
  fr: ['les', 'des', 'une', 'vous', 'votre', 'vos', 'cette', 'avec', 'quand', 'chaque', 'jouez', 'carte', 'cartes', 'unité', 'unités', 'peut', 'pouvez', 'dans', 'sur', 'ennemie', 'ennemi', 'ennemies', 'alliée', 'allié', 'alliées', 'tour', 'piochez', 'infligez', 'dégâts', 'puissance', 'pour', 'son', 'ses', 'leur', 'leurs', 'qui', 'est', 'aux', 'lorsque', 'elle', 'pas', 'plus', 'tout', 'toute', 'moment', 'avant', 'après', 'sort', 'sorts', 'renvoyez', 'propriétaire', 'contrôleur', 'choisissez', 'regardez', 'dessus', 'deck', 'champ', 'bataille', 'gagnez', 'tuez', 'jusqu', 'début', 'fin', 'lui', 'cela', 'ceci', 'chacune', 'chacun', 'autre', 'autres', 'phase'],
};

const HAN = /\p{Script=Han}/gu;

export function hanChars(text: string): Set<string> {
  return new Set(text.match(HAN) ?? []);
}

/** Kleingeschriebene Wörter aus Buchstaben (inkl. Akzenten), mindestens 3 Zeichen. */
export function latinWords(text: string): Set<string> {
  const words = text.normalize('NFC').toLowerCase().match(/\p{Script=Latin}{3,}/gu) ?? [];
  return new Set(words);
}

export const isHanLanguage = (lang: string) => lang.startsWith('zh') || lang === 'ja';

/** Anzahl unterschiedlicher Han-Zeichen aus dem OCR-Text, die im chinesischen Kartentext vorkommen. */
export function scoreHan(ocrText: string, cardText: string | undefined): number {
  if (!cardText) return 0;
  const expected = hanChars(cardText);
  let score = 0;
  for (const c of hanChars(ocrText)) if (expected.has(c)) score++;
  return score;
}

/**
 * Punkte je Latin-Sprache: Wörter aus dem OCR-Text, die nur zum Vokabular dieser Sprache passen.
 * Vokabular = Kartentext dieser Sprache (nur wenn er sich von dem einer früheren Sprache unterscheidet) + typische Wörter.
 */
export function scoreLatin(ocrText: string, texts: Record<string, string>, latin: string[]): Record<string, number> {
  const vocab = new Map(
    latin.map((l, i) => {
      // Gleicher Text wie eine frühere Sprache (Galerie ohne Übersetzung) zählt nur für die frühere.
      const own = texts[l];
      const distinctText = own && !latin.slice(0, i).some((o) => texts[o] === own) ? own : '';
      return [l, latinWords(`${distinctText} ${(COMMON_WORDS[l] ?? []).join(' ')}`)];
    }),
  );
  const seen = latinWords(ocrText);
  const scores: Record<string, number> = {};
  for (const lang of latin) {
    const others = latin.filter((l) => l !== lang).map((l) => vocab.get(l)!);
    let score = 0;
    for (const w of seen) if (vocab.get(lang)!.has(w) && !others.some((o) => o.has(w))) score++;
    scores[lang] = score;
  }
  return scores;
}

/** Beste Sprache, wenn sie genug Treffer hat und deutlich (mindestens 1,5×) vor der zweiten liegt. */
function pickLatin(scores: Record<string, number>, latin: string[], minWords: number): string | null {
  const ranked = latin.map((l) => [l, scores[l] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (!best || best[1] < minWords) return null;
  return best[1] >= 1.5 * (second?.[1] ?? 0) && best[1] > (second?.[1] ?? 0) ? best[0] : null;
}

/**
 * Zweistufig: erst mit Latin-OCR lesen (schnell, deckt die meisten Karten ab), nur wenn das nicht
 * eindeutig ist, mit chinesischer OCR nachlesen.
 * @param read  liest das Textfeld mit 'latin'- oder 'han'-Modell
 * @param texts Name + Regeltext der erkannten Karte je Sprache
 */
export async function detectLanguage(
  read: (script: 'latin' | 'han') => Promise<string>,
  texts: Record<string, string>,
  languages: string[],
  options: DetectOptions = DEFAULT_DETECT,
  /**
   * Wie gut der lateinisch gelesene Text zum englischen Text der Karte passt (siehe textmatch.latinMatch).
   * name: englischer Kartenname (siehe showsName).
   */
  latin?: { match: (text: string) => number; noLatinBelow: number; latinProof?: number; name?: string },
): Promise<LanguageGuess> {
  const latinLangs = languages.filter((l) => !isHanLanguage(l));
  const han = languages.find(isHanLanguage);
  let scores: Record<string, number> = {};
  let latinText = '';
  let hanText = '';
  // Englischer Regeltext oder Name dieser Karte im gelesenen Text: Ausschlusskriterium für Chinesisch
  const showsEnglish = (text: string) =>
    printedLanguageCode(text) !== null ||
    (!!latin && (latin.match(text) >= (latin.latinProof ?? LATIN_PROOF) || (!!latin.name && showsName(text, latin.name))));

  if (latinLangs.length) {
    latinText = await read('latin');
    scores = scoreLatin(latinText, texts, latinLangs);
    const only = latinLangs.length === 1 && !han;
    const lang = only ? latinLangs[0] : pickLatin(scores, latinLangs, options.minWords);
    // Chinesischer Text ergibt mit dem Latin-Modell Zeichensalat, der zufällig kurze englische Wörter
    // treffen kann. Knappe Latin-Ergebnisse daher nur annehmen, wenn es keine Han-Sprache gibt.
    if (lang && (!han || (scores[lang] ?? 0) >= options.minWords + 2)) return { lang, scores, reason: only ? 'only' : 'words' };
    // Englischer Regeltext dieser Karte gelesen: kein chinesischer Druck, egal was die Han-OCR meint
    if (han && latin && showsEnglish(latinText)) {
      const code = printedLanguageCode(latinText);
      const lang = code && latinLangs.includes(code) ? code : (pickLatin(scores, latinLangs, 1) ?? latinLangs[0]);
      return { lang, scores, reason: 'words' };
    }
  }
  if (han) {
    const text = (hanText = await read('han'));
    scores[han] = scoreHan(text, texts[han]);
    // Ohne Vergleichstext reichen viele Han-Zeichen; mit Vergleichstext müssen auch ein paar davon passen,
    // sonst ist es Zeichensalat (z. B. von Artwork oder gedrehtem Text).
    const enoughHan = looksHan(text) && (!texts[han] || scores[han] >= 2);
    if (scores[han] >= options.minHan || enoughHan) return { lang: han, scores, reason: 'han' };
  }
  if (latinLangs.length) {
    const lang = pickLatin(scores, latinLangs, options.minWords);
    if (lang) return { lang, scores, reason: 'words' };
  }
  // Kein englischer Text zu sehen, obwohl die Karte feststeht: chinesischer Druck. Außer die chinesische
  // Texterkennung hat englischen Text gelesen (sie liest auch Lateinisch, manchmal besser als das Latin-Modell).
  if (han && latin && !showsEnglish(hanText) && latinLangs.every((l) => (scores[l] ?? 0) < options.minWords) && latin.match(latinText) < latin.noLatinBelow) {
    return { lang: han, scores, reason: 'no-latin' };
  }
  return { lang: null, scores };
}
