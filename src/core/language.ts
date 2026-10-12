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
}

export interface DetectOptions {
  /** Mindestanzahl passender Han-Zeichen für Chinesisch. */
  minHan: number;
  /** Mindestanzahl sprachtypischer Wörter für eine Latin-Sprache. */
  minWords: number;
}

export const DEFAULT_DETECT: DetectOptions = { minHan: 4, minWords: 2 };

/**
 * Bereich der Karte mit Name und Regeltext (Anteile von Breite/Höhe). Nur dieser Teil wird gelesen;
 * auf dem Artwork liefert die OCR nur Rauschen.
 */
export const TEXT_REGION = { left: 0.04, top: 0.5, right: 0.96, bottom: 0.97 };

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
): Promise<LanguageGuess> {
  const latin = languages.filter((l) => !isHanLanguage(l));
  const han = languages.find(isHanLanguage);
  let scores: Record<string, number> = {};

  if (latin.length) {
    scores = scoreLatin(await read('latin'), texts, latin);
    const lang = latin.length === 1 && !han ? latin[0] : pickLatin(scores, latin, options.minWords);
    if (lang) return { lang, scores };
  }
  if (han) {
    scores[han] = scoreHan(await read('han'), texts[han]);
    if (scores[han] >= options.minHan) return { lang: han, scores };
  }
  return { lang: null, scores };
}
