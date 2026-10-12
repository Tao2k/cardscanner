/**
 * Bestimmt die Drucksprache einer Karte aus OCR-Text.
 *
 * Der Druck ist zu diesem Zeitpunkt schon über das Bild erkannt; wir kennen also Name und
 * Regeltext der Karte in jeder Sprache und prüfen nur, welche Fassung der gelesene Text trifft.
 * Chinesisch erkennt man an Han-Schriftzeichen, Englisch und Französisch an Wörtern, die nur
 * in einer der beiden Fassungen vorkommen.
 */

export interface LanguageGuess {
  /** null = nicht eindeutig; dann entscheidet der Aufrufer (z. B. zuletzt erkannte Sprache). */
  lang: string | null;
  scores: Record<string, number>;
}

export interface DetectOptions {
  /** Mindestanzahl Han-Zeichen für Chinesisch. */
  minHan: number;
  /** Mindestanzahl sprachtypischer Wörter für eine Latin-Sprache. */
  minWords: number;
}

const DEFAULTS: DetectOptions = { minHan: 4, minWords: 2 };

/** Häufige Wörter auf Kartentexten; helfen, wenn Name und Text kaum Unterschiede liefern. */
const COMMON_WORDS: Record<string, string[]> = {
  en: ['the', 'you', 'your', 'and', 'this', 'that', 'with', 'when', 'each', 'play', 'card', 'cards', 'unit', 'units', 'may', 'its', 'from', 'into', 'enemy', 'friendly', 'turn', 'draw', 'deal', 'damage', 'might'],
  fr: ['les', 'des', 'une', 'vous', 'votre', 'vos', 'cette', 'avec', 'quand', 'chaque', 'jouez', 'carte', 'cartes', 'unité', 'unités', 'peut', 'pouvez', 'dans', 'sur', 'ennemie', 'alliée', 'tour', 'piochez', 'infligez', 'dégâts', 'puissance'],
};

const HAN = /\p{Script=Han}/gu;

export function hanCount(text: string): number {
  return text.match(HAN)?.length ?? 0;
}

/** Kleingeschriebene Wörter aus Buchstaben (inkl. Akzenten), mindestens 3 Zeichen. */
export function latinWords(text: string): Set<string> {
  const words = text.normalize('NFC').toLowerCase().match(/\p{Script=Latin}{3,}/gu) ?? [];
  return new Set(words);
}

/**
 * @param ocrText    gelesener Text der Karte
 * @param texts      Name + Regeltext der erkannten Karte je Sprache, z. B. { en, fr, 'zh-CN' }
 * @param languages  erlaubte Sprachen des Spiels
 */
export function detectLanguage(
  ocrText: string,
  texts: Record<string, string>,
  languages: string[],
  options: DetectOptions = DEFAULTS,
): LanguageGuess {
  const scores: Record<string, number> = {};
  const han = languages.find((l) => l.startsWith('zh'));
  if (han) {
    scores[han] = hanCount(ocrText);
    if (scores[han] >= options.minHan) return { lang: han, scores };
  }

  const latin = languages.filter((l) => !l.startsWith('zh'));
  const vocab = new Map(latin.map((l) => [l, latinWords(`${texts[l] ?? ''} ${(COMMON_WORDS[l] ?? []).join(' ')}`)]));
  const seen = latinWords(ocrText);
  for (const lang of latin) {
    const others = latin.filter((l) => l !== lang).map((l) => vocab.get(l)!);
    let score = 0;
    for (const w of vocab.get(lang)!) {
      if (seen.has(w) && !others.some((o) => o.has(w))) score++;
    }
    scores[lang] = score;
  }
  const ranked = latin.map((l) => [l, scores[l]] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  if (best && best[1] >= options.minWords && best[1] > (second?.[1] ?? 0)) return { lang: best[0], scores };
  // Nur eine Latin-Sprache im Spiel: lesbarer Latin-Text reicht.
  if (latin.length === 1 && seen.size >= options.minWords) return { lang: latin[0], scores };
  return { lang: null, scores };
}
