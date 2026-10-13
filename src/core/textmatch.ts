import type { Match } from './matcher';
import type { Printing } from './types';

/**
 * Karte am gelesenen Text erkennen (Name und Regeltext, per OCR).
 *
 * Das Bild allein verwechselt vor allem Karten mit ähnlichem Artwork. Der Text unterscheidet die
 * meisten davon sicher. Drucke mit gleichem Text (Varianten derselben Karte, z. B. Alternate Art)
 * bilden eine Gruppe; innerhalb einer Gruppe entscheiden Sammlernummer oder Bild.
 *
 * Bewertung je Gruppe: Anteil des Kartenvokabulars, der im gelesenen Text vorkommt, gewichtet nach
 * Seltenheit (Wörter wie „the“ stehen auf fast jeder Karte und zählen kaum). Einzelne Lesefehler
 * werden toleriert (ein Buchstabe falsch, fehlend oder zu viel).
 */

export interface TextGroup {
  /** Drucke mit diesem Text (Indizes in printings). */
  members: number[];
  /** Wort (Latin, ohne Akzente) bzw. Han-Zeichen → Gewicht. */
  latin: Map<string, number>;
  han: Map<string, number>;
  latinTotal: number;
  hanTotal: number;
}

export interface TextIndex {
  groups: TextGroup[];
  /** Druck → Gruppe. */
  groupOf: Int32Array;
  collectorNumbers: string[];
}

export interface TextScore {
  group: number;
  score: number;
}

export interface TextMatch {
  /** Gruppen nach Bewertung, beste zuerst (nur mit Bewertung > 0). */
  ranked: TextScore[];
  /** Gelesene Sammlernummer, z. B. „123a“ aus „123a/298“. */
  collector: string | null;
}

export interface TextDecisionConfig {
  /** Mindestbewertung der besten Gruppe. */
  minScore: number;
  /** Mindestabstand zur zweitbesten Gruppe. */
  minMargin: number;
  /** Abstand, ab dem der Text einem sicheren Bildtreffer widersprechen darf (dann wird nachgefragt). */
  vetoMargin: number;
  /** Bildabstand innerhalb einer Gruppe, ab dem das Bild die Variante bestimmt. */
  variantMargin: number;
}

/**
 * Kalibriert mit `npm run eval -- --text 600` (Oktober 2026, verzerrte Kartenbilder): Mit diesen Schwellen
 * war die beste Textgruppe in 199 von 202 Fällen richtig (untere 95-%-Schranke 96 %). Ohne Nachfrage
 * gespeichert wurden 86 % statt 62 % (nur Bild), davon 99,6 % richtig; am Text 78/79, per Sammlernummer 69/69.
 */
export const DEFAULT_TEXT_DECISION: TextDecisionConfig = { minScore: 0.35, minMargin: 0.15, vetoMargin: 0.3, variantMargin: 0.06 };

/** Sicherheit einer am Text oder an der Sammlernummer erkannten Karte (Messung: 147/148 richtig). */
export const TEXT_CONFIDENCE = 0.97;

/** Bewertungen sind gedämpft: Karten mit sehr wenig Text erreichen keine hohen Werte (zu leicht zufällig zu treffen). */
const SMOOTHING = 4;
/** Namenswörter stehen groß auf der Karte und werden zuverlässig gelesen. */
const NAME_WEIGHT = 1.5;

const stripMarks = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Wörter aus Buchstaben, mindestens 3 Zeichen, klein und ohne Akzente. */
export function tokens(text: string): string[] {
  return stripMarks(text).match(/\p{Script=Latin}{3,}/gu) ?? [];
}

const HAN = /\p{Script=Han}/gu;

function deletions(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) out.push(word.slice(0, i) + word.slice(i + 1));
  return out;
}

/** Ab dieser Länge wird ein Lesefehler toleriert; kürzere Wörter müssen genau stimmen. */
const FUZZY_FROM = 5;

/** Menge der gelesenen Wörter, dazu ihre Varianten mit einem Buchstaben weniger (für unscharfen Vergleich). */
function ocrVocabulary(text: string) {
  const words = new Set(tokens(text));
  const dels = new Set<string>();
  for (const w of words) if (w.length >= FUZZY_FROM) for (const d of deletions(w)) dels.add(d);
  return { words, dels };
}

/** Wort im gelesenen Text, höchstens ein Buchstabe falsch, fehlend oder zu viel. */
function found(word: string, v: { words: Set<string>; dels: Set<string> }): boolean {
  if (v.words.has(word)) return true;
  if (word.length < FUZZY_FROM) return false;
  if (v.dels.has(word)) return true;
  for (const d of deletions(word)) if (v.words.has(d) || v.dels.has(d)) return true;
  return false;
}

/** Baut den Index aus dem Katalog (einmal je Spiel). */
export function buildTextIndex(printings: Printing[]): TextIndex {
  const byKey = new Map<string, number[]>();
  printings.forEach((p, i) => {
    const key = stripMarks(p.texts?.en ?? p.cardName).replace(/\s+/g, ' ').trim() || `#${p.printingId}`;
    const list = byKey.get(key) ?? [];
    list.push(i);
    byKey.set(key, list);
  });
  const raw = [...byKey.values()].map((members) => {
    const p = printings[members[0]];
    const latinName = new Set([p.cardName, ...Object.entries(p.names ?? {}).filter(([l]) => !l.startsWith('zh') && l !== 'ja').map(([, n]) => n)].flatMap(tokens));
    const latinText = new Set(Object.entries(p.texts ?? {}).filter(([l]) => !l.startsWith('zh') && l !== 'ja').flatMap(([, t]) => tokens(t)));
    const hanText = Object.entries({ ...p.texts, ...Object.fromEntries(Object.entries(p.names ?? {}).map(([l, n]) => [`name:${l}`, n])) })
      .filter(([l]) => l.includes('zh') || l.includes('ja'))
      .map(([, t]) => t)
      .join(' ');
    return { members, latinName, latinWords: new Set([...latinName, ...latinText]), hanChars: new Set(hanText.match(HAN) ?? []) };
  });
  // Seltenheit: Wörter auf wenigen Karten wiegen viel, Wörter auf fast allen kaum
  const df = new Map<string, number>();
  for (const g of raw) for (const w of [...g.latinWords, ...g.hanChars]) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((raw.length + 1) / ((df.get(w) ?? 0) + 0.5));
  const groups: TextGroup[] = raw.map((g) => {
    const latin = new Map([...g.latinWords].map((w) => [w, idf(w) * (g.latinName.has(w) ? NAME_WEIGHT : 1)] as const));
    const han = new Map([...g.hanChars].map((c) => [c, idf(c)] as const));
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    return { members: g.members, latin, han, latinTotal: sum(latin), hanTotal: sum(han) };
  });
  const groupOf = new Int32Array(printings.length);
  groups.forEach((g, gi) => g.members.forEach((m) => (groupOf[m] = gi)));
  return { groups, groupOf, collectorNumbers: printings.map((p) => normalizeNumber(p.collectorNumber)) };
}

/** „007a“ → „7a“, „229*“ bleibt. */
export function normalizeNumber(n: string): string {
  return n.trim().toLowerCase().replace(/^0+(?=\d)/, '');
}

/** Sammlernummer aus dem gelesenen Text, z. B. „OGN • 123a/298“. */
export function readCollectorNumber(text: string): string | null {
  const m = text.match(/(\d{1,3})\s*([a-z*]?)\s*\/\s*\d{2,3}/i);
  return m ? normalizeNumber(m[1] + m[2]) : null;
}

type Vocabulary = ReturnType<typeof ocrVocabulary>;

function scoreGroup(g: TextGroup, latin: Vocabulary | null, han: Set<string> | null): number {
  let score = 0;
  if (latin && g.latinTotal) {
    let hit = 0;
    for (const [w, weight] of g.latin) if (found(w, latin)) hit += weight;
    score = Math.max(score, hit / (g.latinTotal + SMOOTHING));
  }
  if (han && g.hanTotal) {
    let hit = 0;
    for (const [c, weight] of g.han) if (han.has(c)) hit += weight;
    score = Math.max(score, hit / (g.hanTotal + SMOOTHING));
  }
  return score;
}

/** Bewertet alle Textgruppen gegen den gelesenen Text (Latin- und/oder Han-OCR). */
export function matchText(index: TextIndex, ocr: { latin?: string; han?: string }): TextMatch {
  const latin = ocr.latin ? ocrVocabulary(ocr.latin) : null;
  const han = ocr.han ? new Set(ocr.han.match(HAN) ?? []) : null;
  const ranked: TextScore[] = [];
  index.groups.forEach((g, group) => {
    const score = scoreGroup(g, latin, han);
    if (score > 0) ranked.push({ group, score });
  });
  ranked.sort((a, b) => b.score - a.score);
  return { ranked, collector: readCollectorNumber(`${ocr.latin ?? ''} ${ocr.han ?? ''}`) };
}

/**
 * Wie gut der lateinisch gelesene Text zum englischen (bzw. lateinischen) Text dieses Drucks passt (0–1).
 * Bei chinesischen Drucken ist das fast 0, bei englischen meist deutlich mehr; hilft der Spracherkennung,
 * wenn die chinesische Texterkennung nichts liefert.
 */
export function latinMatch(index: TextIndex, printing: number, latinText: string): number {
  return scoreGroup(index.groups[index.groupOf[printing]], ocrVocabulary(latinText), null);
}

/** Beste Textgruppe, wenn sie eindeutig ist, sonst null. */
export function textWinner(m: TextMatch, cfg: TextDecisionConfig = DEFAULT_TEXT_DECISION): TextScore | null {
  const [a, b] = m.ranked;
  if (!a || a.score < cfg.minScore || a.score - (b?.score ?? 0) < cfg.minMargin) return null;
  return a;
}

export type Decision =
  | { action: 'save'; index: number; via: 'image' | 'text' | 'number' }
  | { action: 'ask'; candidates: number[]; reason: 'unsure' | 'conflict' | 'variant' };

/**
 * Bild und Text zusammen:
 * - Text sehr eindeutig und Bild sicher, aber andere Karte: nachfragen (einer von beiden irrt).
 * - Text eindeutig: Karte steht fest. Variante per Sammlernummer, sonst per Bild (wenn deutlich), sonst nachfragen
 *   mit nur den Varianten dieser Karte.
 * - Text unklar, Bild unsicher: Trägt genau einer der Bildtreffer die gelesene Sammlernummer, ist es dieser.
 * - Sonst wie bisher nur das Bild.
 * @param image   gemittelte Bildtreffer, beste zuerst
 * @param imageConfident ob das Bild allein sicher genug ist
 */
export function decide(
  index: TextIndex,
  image: Match[],
  imageConfident: boolean,
  text: TextMatch | null,
  candidates: number,
  cfg: TextDecisionConfig = DEFAULT_TEXT_DECISION,
): Decision {
  const imageTop = image[0]?.index ?? -1;
  const winner = text ? textWinner(text, cfg) : null;
  const byNumber = (list: number[]) => (text?.collector ? list.filter((m) => index.collectorNumbers[m] === text.collector) : []);
  if (!winner) {
    if (imageConfident) return { action: 'save', index: imageTop, via: 'image' };
    const numbered = byNumber(image.map((m) => m.index));
    if (numbered.length === 1) return { action: 'save', index: numbered[0], via: 'number' };
    return { action: 'ask', candidates: image.slice(0, candidates).map((m) => m.index), reason: 'unsure' };
  }
  const members = index.groups[winner.group].members;
  if (imageConfident) {
    const second = text!.ranked[1]?.score ?? 0;
    if (members.includes(imageTop) || winner.score - second < cfg.vetoMargin) return { action: 'save', index: imageTop, via: 'image' };
    // Widerspruch: Textkarte zuerst, dann was das Bild sah
    const list = [...members.slice(0, candidates - 1), imageTop];
    return { action: 'ask', candidates: [...new Set(list)], reason: 'conflict' };
  }
  if (members.length === 1) return { action: 'save', index: members[0], via: 'text' };
  // Varianten: Sammlernummer, wenn sie genau eine trifft
  const numbered = byNumber(members);
  if (numbered.length === 1) return { action: 'save', index: numbered[0], via: 'text' };
  // Sonst das Bild, aber nur unter den Varianten dieser Karte
  const floor = image.length ? image[image.length - 1].score : 0;
  const scoreOf = (m: number) => image.find((x) => x.index === m)?.score ?? floor;
  const ranked = [...members].sort((a, b) => scoreOf(b) - scoreOf(a));
  if (scoreOf(ranked[0]) - scoreOf(ranked[1]) >= cfg.variantMargin) return { action: 'save', index: ranked[0], via: 'text' };
  return { action: 'ask', candidates: ranked.slice(0, Math.max(candidates, 2)), reason: 'variant' };
}
