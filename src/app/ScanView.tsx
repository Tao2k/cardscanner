import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AddResult, CollectionService, ScanInput } from '../core/collection';
import type { LearningService, Sample } from '../core/learning';
import { guideRect } from '../core/geometry';
import { CONDITIONS, type CollectionItem, type Condition, type Finish, type Printing } from '../core/types';
import type { Catalogs } from './App';
import { CONDITION_CROP_HEIGHT, drawAroundCard, drawCard, frameLuma, grabCard, OCR_CROP_HEIGHT, setTorch, startCamera, stopCamera, torchSupported } from './camera';
import { AutoTorch } from '../core/light';
import { SHADOW_FRAMES, SHADOW_HINT } from '../core/shading';
import { CONDITION_MARGIN, learnConditionScale, scaleThresholds } from '../core/condition';
import { finishesOf, learnFoilShare } from '../core/foil';
import { conditionFeedback, foilFeedback, languageFeedback } from './feedback';
import { learnThreshold } from '../core/thresholds';
import { analyzeCanvas, type CardAnalysis } from './analyze';
import { detectLanguage, IMAGE_LANGUAGE_MARGIN, isHanLanguage, languageFromImage, NO_LATIN_BELOW, textViews, type LanguageGuess, type TextView } from '../core/language';
import { cropTextRegion, cropView, readText, warmUpOcr, type Script } from './ocr';
import { buildTextIndex, decide, latinMatch, matchText, TEXT_CONFIDENCE, textWinner, type Decision, type TextIndex, type TextMatch } from '../core/textmatch';
import type { Prefs } from './prefs';
import type { Recognizer } from './recognizer';
import { MODEL_KEY } from '../core/embedder';
import { printingCode, printingLabel } from './format';
import { formatEur, itemPrice } from '../core/prices';
import { captureFx, snapshotOf, type CaptureFx } from './captureFx';
import { slotKey } from './binder';
import { DEFAULT_STABILIZER, Stabilizer, type StableResult } from '../core/stabilizer';
import { accuracyText, judgeStats, loadStats, strictness, updateStats, type Judgement } from './stats';
import { nameIn } from '../core/catalog';
import { APP_VERSION, updates } from './updates';

interface Props {
  catalogs: Catalogs | null;
  recognizer: Recognizer | null;
  status: string;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  service: CollectionService;
  learning: LearningService;
  onChange(): void;
  /** Ein Exemplar (key „gameId|printingId“) wurde per Scan hinzugefügt (+1) oder rückgängig gemacht (−1), für den Hinweis am Tab „Sammlung“ und den Binder. */
  onAdded(delta: number, key: string): void;
  /** Ein Scan wurde auf einen anderen Druck korrigiert (Keys wie bei onAdded). */
  onMoved(from: string, to: string): void;
  /** Eigene Scans haben sich geändert; die Erkennung soll sie neu einlesen. */
  onLearn(): void;
}

/** Immer das englische Kartenbild, auch bei chinesischen Drucken. */
const thumb = (p: Printing) => p.thumbUrl ?? p.imageUrl;

const FINISHES: { value: Finish; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'foil', label: 'Foil' },
];

interface Saved {
  result: AddResult;
  printing: Printing;
  input: ScanInput;
  sample?: Sample;
  /** „Falsch erkannt“ wurde gedrückt, der Scan liegt jetzt unter „Prüfen“. */
  flagged?: boolean;
  /** Mit „Richtig“ bestätigt. */
  verified?: boolean;
  /** Deine Bewertung (zählt einmal in der Genauigkeit): richtig oder was falsch war. */
  judged?: Judgement;
  /** Schimmer-Wert, wenn Foil am Foto bestimmt wurde (dann lernt die Erkennung aus Korrekturen). */
  foilScore?: number;
  /** Eindeutig je Scan, für die Foil-Rückmeldung. */
  key: string;
  /** Ob der Zustand geschätzt wurde, sonst warum nicht. */
  conditionNote?: string;
  /** Gesetzt, wenn die Sprache nicht erkannt, sondern angenommen wurde. */
  languageNote?: string;
  /** Woher die Angabe Foil/Normal kommt. */
  finishNote?: string;
  /** Ohne Nachfrage gespeichert (zählt für die Genauigkeit). */
  auto?: boolean;
  /** Geschätzte Sicherheit des Treffers (nur bei automatisch gespeicherten). */
  confidence?: number;
  /** Am Kartentext erkannt (das Bild allein war zu unsicher). */
  byText?: boolean;
  /** Wie gut der lateinisch gelesene Text zum englischen Kartentext passte (für das Lernen der Sprache). */
  latinScore?: number;
  /** Gemessene Abnutzung, wenn der Zustand geschätzt wurde (für das Lernen des Zustands). */
  wear?: { edge: number; corner: number };
}

type FixKind = 'card' | 'variant' | 'language' | 'finish' | 'condition';

/** Was im Moment des Treffers aufgenommen wurde; ausgewertet wird, sobald die Karte feststeht. */
interface Captured {
  gameId: string;
  stable: StableResult;
  vector: Float32Array | null;
  imageLanguage: string | null;
  region: HTMLCanvasElement | null;
  /** Die ganze Karte in OCR-Auflösung, für andere Ansichten (z. B. gedrehte Querformat-Karten). */
  card: HTMLCanvasElement | null;
  /** Gelesener Text je Schrift (und Ansicht), einmal gelesen für Erkennung und Sprache. */
  ocr: Map<string, Promise<string>>;
  /** Schriften, deren Texterkennung zu lange gebraucht hat. */
  timedOut: Set<Script>;
  shot: { ctx: CanvasRenderingContext2D; guide: { x: number; y: number; width: number; height: number } } | null;
  /** Standbild der Karte für die Hinzufügen-Animation. */
  snapshot: string | null;
}

/** Knapper Treffer: Kandidaten zum Antippen. */
interface Question {
  captured: Captured;
  candidates: Printing[];
  /** unsure = zu knapp; conflict = Bild und Text sagen verschiedene Karten; variant = Karte klar, Variante nicht. */
  reason: 'unsure' | 'conflict' | 'variant';
}

/**
 * Text einmal lesen, danach aus dem Zwischenspeicher. onStart meldet, dass jetzt wirklich gelesen wird.
 * Ohne view das Textfeld, mit view die so gedrehte und ausgeschnittene Karte.
 */
function readOnce(captured: Captured, script: Script, onStart?: (script: Script | null) => void, view?: TextView): Promise<string> {
  const key = view && view.rotate !== 0 ? `${script}@${view.rotate}` : script;
  const image = key === script ? captured.region : captured.card && view ? cropView(captured.card, view) : null;
  if (!image) return Promise.resolve('');
  let text = captured.ocr.get(key);
  if (!text) {
    onStart?.(script);
    text = readText(image, script).then((r) => {
      if (r.timedOut) captured.timedOut.add(script);
      onStart?.(null);
      return r.text;
    });
    captured.ocr.set(key, text);
  }
  return text;
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')!.drawImage(source, 0, 0);
  return copy;
}

/** Für die Sprache: alle Ansichten des Drucks lesen (Querformat in beiden Drehrichtungen) und den Text aneinanderhängen. */
async function readForLanguage(captured: Captured, printing: Printing, script: Script, onStart?: (script: Script | null) => void): Promise<string> {
  const texts: string[] = [];
  // Nacheinander: Die Texterkennung arbeitet ohnehin ein Bild nach dem anderen ab
  for (const view of textViews(printing)) texts.push(await readOnce(captured, script, onStart, view));
  return texts.join('\n');
}

/** Kurzer Hinweis, woran die Sprache erkannt wurde (oder warum nicht). */
function languageReason(guess: LanguageGuess | null, label: string): string | undefined {
  if (!guess) return undefined;
  if (guess.reason === 'words') return `Sprache ${label}: Text gelesen`;
  if (guess.reason === 'han') return `Sprache ${label}: chinesische Schrift gelesen`;
  if (guess.reason === 'no-latin') return `Sprache ${label}: kein englischer Text gefunden`;
  return undefined;
}

export function ScanView({ catalogs, recognizer, status, prefs, setPrefs, service, learning, onChange, onAdded, onMoved, onLearn }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stabilizer = useRef(new Stabilizer());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [running, setRunning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [guess, setGuess] = useState<{ printing: Printing; score: number; ms: number } | null>(null);
  const [recent, setRecent] = useState<Saved[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [analyzing, setAnalyzing] = useState(false);
  const [reading, setReading] = useState<Script | null>(null);
  /** Zuletzt hinzugefügte Karte, kurz im Kamerabereich angezeigt. */
  const [added, setAdded] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout>>();
  /** Die eben erfasste Karte liegt noch im Bild (wird nicht noch einmal gezählt). */
  const [holding, setHolding] = useState(false);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  /** Blitz und Vorschaubild für eine erfasste Karte (nichts, wenn Bild oder Rahmen fehlen). */
  const startFx = (captured: Captured, flash: boolean): CaptureFx | null =>
    captured.snapshot && guideRef.current && viewfinderRef.current
      ? captureFx(captured.snapshot, guideRef.current.getBoundingClientRect(), viewfinderRef.current.getBoundingClientRect(), flash)
      : null;
  /** Speichern mit Animation; die gespeicherte Karte gilt als erfasst, bis sie aus dem Bild ist. */
  const saveWithFx = async (captured: Captured, printing: Printing, how: 'auto' | 'text' | 'chosen', flash: boolean) => {
    const fx = startFx(captured, flash);
    try {
      await saveScan(captured, printing, how);
      const index = catalogs?.ordered.get(captured.gameId)?.indexOf(printing) ?? -1;
      if (index >= 0) stabilizer.current.markHandled(index);
      fx?.land();
      clearTimeout(addedTimer.current);
      setAdded(printing.cardName);
      addedTimer.current = setTimeout(() => setAdded(null), 2500);
    } catch (e) {
      fx?.cancel();
      throw e;
    }
  };
  const [fixing, setFixing] = useState<{ key: string; kind: FixKind | null } | null>(null);
  const [fixQuery, setFixQuery] = useState('');
  /** Einstellungen (Spiel, Sprache, Foil, Zustand) sind nur bei Bedarf offen. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Scan, dessen Details (Sicherheit, Hinweise, Rückgängig) aufgeklappt sind. */
  const [details, setDetails] = useState<string | null>(null);
  const textIndexes = useRef(new Map<string, TextIndex>());
  const [question, setQuestion] = useState<Question | null>(null);
  const questionRef = useRef<Question | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collecting, setCollecting] = useState(0);
  const [stats, setStats] = useState(loadStats);
  // Foil-Schwelle, gelernt aus deinen Foil-Bestätigungen und -Korrekturen
  const [foilShare, setFoilShare] = useState(() => learnFoilShare(foilFeedback.load()));
  const foilShareRef = useRef(foilShare);
  foilShareRef.current = foilShare;
  // Sprache: ab wie wenig passendem englischem Text ein Druck als chinesisch gilt, gelernt aus deinen Korrekturen
  const learnNoLatin = (f = languageFeedback.load()) => learnThreshold(f, NO_LATIN_BELOW, 0.01, 0.5);
  const noLatinRef = useRef(learnNoLatin());
  // Zustand: wie streng geschätzt wird, gelernt aus deinen Zustandsangaben
  const conditionScaleRef = useRef(learnConditionScale(conditionFeedback.load()));
  const recordAuto = () => setStats(updateStats((s) => ({ auto: s.auto + 1 })));
  // Meldest du viele Fehler, verlangt der Scanner mehr Abstand, bevor er ohne Nachfrage speichert
  const extraMargin = strictness(stats);
  useEffect(() => {
    stabilizer.current = new Stabilizer({ ...DEFAULT_STABILIZER, confidentMargin: DEFAULT_STABILIZER.confidentMargin + extraMargin });
  }, [extraMargin]);
  // Während gescannt, nachgefragt oder korrigiert wird, kommt kein Update dazwischen
  useEffect(() => updates.setBusy(running || !!question || !!fixing), [running, question, fixing]);
  useEffect(() => () => updates.setBusy(false), []);
  const recordAsked = () => setStats(updateStats((s) => ({ asked: s.asked + 1 })));
  const ocrCanvasRef = useRef<HTMLCanvasElement>(null);
  const conditionCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Zuletzt erkannte Sprache; Fallback, wenn der Text nicht eindeutig ist (Stapel sind meist einsprachig). */
  const lastLanguage = useRef<string | null>(null);
  const labelOf = (gameId: string, code: string) => catalogs?.languages.get(gameId)?.find((l) => l.code === code)?.label ?? code;
  const imageEvidence = useRef<{ printing: number; frames: { lang: string; score: number }[][] }>({ printing: -1, frames: [] });

  const streamRef = useRef<MediaStream | null>(null);
  const lumaCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Kann die Kamera ihr Licht einschalten, und ist es gerade an? */
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const torchOnRef = useRef(false);
  torchOnRef.current = torchOn;
  /** Hast du das Licht selbst geschaltet, greift die Automatik bis zum nächsten Scan nicht mehr ein. */
  const torchManual = useRef(false);
  /** Zu dunkel und kein Licht verfügbar (oder aus): Hinweis zeigen. */
  const [dark, setDark] = useState(false);
  /** Starker Schatten auf der Karte in den letzten Frames: Hinweis zeigen. */
  const [shaded, setShaded] = useState(false);
  const shadows = useRef<number[]>([]);

  const switchTorch = async (on: boolean) => {
    if (await setTorch(streamRef.current, on)) setTorchOn(on);
  };

  // Kamera starten/stoppen
  useEffect(() => {
    if (!running) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let recheck: ReturnType<typeof setTimeout> | undefined;
    startCamera(videoRef.current!)
      .then((s) => {
        stream = s;
        if (cancelled) return stopCamera(s);
        streamRef.current = s;
        const v = videoRef.current!;
        setBox({ w: v.clientWidth, h: v.clientHeight });
        // Manche Android-Geräte melden das Licht erst kurz nach dem Start
        setTorchAvailable(torchSupported(s));
        recheck = setTimeout(() => !cancelled && setTorchAvailable(torchSupported(s)), 800);
      })
      .catch((e: Error) => {
        setCamError(
          e.name === 'NotAllowedError'
            ? 'Kein Kamerazugriff. Bitte die Kamera für diese Seite erlauben.'
            : `Kamera nicht verfügbar: ${e.message}`,
        );
        setRunning(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(recheck);
      // Mit dem Beenden der Kamera geht auch ihr Licht aus
      stopCamera(stream);
      streamRef.current = null;
      torchManual.current = false;
      setTorchAvailable(false);
      setTorchOn(false);
      setDark(false);
      setShaded(false);
      shadows.current = [];
    };
  }, [running]);

  // Helligkeit messen; ist es zu dunkel, Kameralicht automatisch einschalten
  useEffect(() => {
    if (!running) return;
    const auto = new AutoTorch();
    auto.reset(performance.now());
    const timer = setInterval(() => {
      const luma = videoRef.current && lumaCanvasRef.current ? frameLuma(videoRef.current, lumaCanvasRef.current) : null;
      if (luma === null) return;
      const fire = auto.push(luma, performance.now());
      const canAuto = prefsRef.current.torchAuto && !torchManual.current && torchSupported(streamRef.current);
      if (fire && canAuto && !torchOnRef.current) void switchTorch(true);
      setDark(auto.dark && !torchOnRef.current && !(fire && canAuto));
    }, 250);
    return () => clearInterval(timer);
  }, [running]);

  /**
   * Wertet Sprache, Zustand und Foil aus und speichert die Karte.
   * how: 'auto' = sicher erkannt, 'chosen' = nach Nachfrage von dir gewählt (wird zum Referenzbild).
   */
  const saveScan = async (captured: Captured, printing: Printing, how: 'auto' | 'text' | 'chosen') => {
    if (!catalogs) return;
    const { gameId, stable, vector, region, shot } = captured;
    const p = prefsRef.current;
    const printings = catalogs.ordered.get(gameId) ?? [];
    const languages = catalogs.languages.get(gameId)?.map((l) => l.code) ?? ['en'];
    const autoLanguage = p.language === 'auto' || !languages.includes(p.language);
    // Das Bild-Indiz zur Sprache gilt nur für den Druck, für den es gesammelt wurde
    const imageLanguage = printings[stable.index] === printing ? captured.imageLanguage : null;
    setAnalyzing(true);
    const index = textIndexFor(gameId);
    const printingIndex = printings.indexOf(printing);
    const matchLatin = (text: string) => (printingIndex >= 0 ? latinMatch(index, printingIndex, text) : 1);
    const [languageGuess, analysis] = await Promise.all([
      autoLanguage && region
        ? detectLanguage((script) => readForLanguage(captured, printing, script, setReading), printing.texts ?? {}, languages, undefined, {
            match: matchLatin,
            noLatinBelow: noLatinRef.current,
            name: printing.cardName,
          })
        : Promise.resolve(null),
      shot
        ? analyzeCanvas(shot.ctx, shot.guide, catalogs.compareRefs(gameId, printing.printingId), foilShareRef.current, scaleThresholds(conditionScaleRef.current)).catch(
            (e: Error): CardAnalysis => ({ condition: { condition: null, reason: e.message, edge: 0, corner: 0, fit: 0 }, foil: null }),
          )
        : Promise.resolve(null),
    ]);
    setAnalyzing(false);
    // Für das Lernen der Sprache: Passte der lateinisch gelesene Text zum englischen Kartentext?
    const latinText = captured.ocr.has('latin') ? await readForLanguage(captured, printing, 'latin') : null;
    const latinScore = latinText !== null && languages.some(isHanLanguage) ? matchLatin(latinText) : undefined;
    let language = p.language;
    let languageNote: string | undefined;
    if (autoLanguage) {
      // Reihenfolge: gelesener Text, dann Bild, dann die zuletzt erkannte Sprache (Stapel sind meist einsprachig)
      const detected = languageGuess?.lang ?? imageLanguage;
      language = detected ?? lastLanguage.current ?? languages[0];
      if (!detected) {
        const slow = captured.timedOut.has('han') ? ' (Texterkennung zu langsam)' : '';
        languageNote = `Sprache unsicher${slow}, angenommen: ${labelOf(gameId, language)}`;
      } else {
        languageNote = languageGuess?.lang ? languageReason(languageGuess, labelOf(gameId, language)) : `Sprache ${labelOf(gameId, language)}: am Kartenbild erkannt`;
      }
      if (detected) lastLanguage.current = detected;
    }
    const conditionGuess = p.conditionAuto ? analysis?.condition : undefined;
    const condition = conditionGuess?.condition ?? p.condition;
    const wear = conditionGuess?.condition ? { edge: conditionGuess.edge, corner: conditionGuess.corner } : undefined;
    const conditionNote = !p.conditionAuto
      ? undefined
      : conditionGuess?.condition
        ? 'Zustand geschätzt'
        : `Zustand nicht geschätzt, Standard ${p.condition}`;
    // Foil: gibt es den Druck nur in einer Ausführung, steht sie fest; sonst entscheidet das Foto
    let finish = p.finish;
    let finishNote: string | undefined;
    let foilScore: number | undefined;
    if (p.finishAuto) {
      const finishes = finishesOf(printing);
      const foil = analysis?.foil;
      if (finishes.length === 1) {
        finish = finishes[0];
        finishNote = finish === 'foil' ? 'Nur als Foil gedruckt' : undefined;
      } else if (foil && foil.foil !== null) {
        finish = foil.foil ? 'foil' : 'normal';
        finishNote = `${foil.foil ? 'Foil' : 'Kein Foil'} (Schimmer ${Math.round(foil.score * 100)} %, Grenze ${Math.round(foilShareRef.current * 100)} %)`;
        foilScore = foil.score;
      } else {
        finishNote = `Foil nicht geprüft, Standard ${p.finish === 'foil' ? 'Foil' : 'Normal'}`;
      }
    }
    const input: ScanInput = {
      gameId,
      printingId: printing.printingId,
      language,
      finish,
      condition,
      location: '',
      confirmed: true,
      matchScore: stable.score,
      alternatives: [stable.index, ...stable.alternatives].map((i) => printings[i].printingId).filter((id) => id !== printing.printingId),
    };
    const result = await service.addScan(input);
    onAdded(1, slotKey(gameId, printing.printingId));
    // Den Scan merken: bestätigst oder korrigierst du ihn später, lernt die Erkennung daraus
    const sample = vector
      ? await learning
          .recordScan({ gameId, printingId: printing.printingId, itemId: result.item.itemId, vector, confident: true, model: MODEL_KEY })
          .catch(() => undefined)
      : undefined;
    // Von dir gewählt: Der Scan wird sofort zum eigenen Referenzbild
    if (how === 'chosen' && sample) {
      await learning.confirmItem(result.item.itemId, printing.printingId);
      sample.source = 'user';
    }
    if (how !== 'chosen') recordAuto();
    navigator.vibrate?.(40);
    setRecent((r) => [{ result, printing, input, sample, conditionNote, languageNote, finishNote, auto: how !== 'chosen', confidence: how === 'auto' ? stable.confidence : how === 'text' ? TEXT_CONFIDENCE : undefined, byText: how === 'text', latinScore, wear, foilScore, key: `${result.item.itemId}-${Date.now()}` }, ...r].slice(0, 5));
    onChange();
    if (sample) onLearn();
  };

  const textIndexFor = (gameId: string): TextIndex => {
    let index = textIndexes.current.get(gameId);
    if (!index) {
      index = buildTextIndex(catalogs?.ordered.get(gameId) ?? []);
      textIndexes.current.set(gameId, index);
    }
    return index;
  };

  /**
   * Bild und Kartentext zusammen: Der Text macht knappe Bildtreffer eindeutig und fängt sichere
   * Bildtreffer ab, wenn er klar eine andere Karte zeigt. Chinesisch wird nur nachgelesen, wenn das
   * Bild unsicher ist und der lateinische Text nichts ergibt (das Modell ist langsam).
   */
  const identify = async (captured: Captured): Promise<Decision> => {
    const { gameId, stable } = captured;
    const index = textIndexFor(gameId);
    let text: TextMatch | null = null;
    if (captured.region) {
      const latin = await readOnce(captured, 'latin', setReading);
      text = matchText(index, { latin });
      const hasHan = catalogs?.languages.get(gameId)?.some((l) => l.code.startsWith('zh'));
      if (!stable.confident && hasHan && !textWinner(text)) text = matchText(index, { latin, han: await readOnce(captured, 'han', setReading) });
    }
    return decide(index, stable.ranked, stable.confident, text, DEFAULT_STABILIZER.candidates);
  };

  // Erkennungsschleife: ein Frame nach dem anderen, so schnell wie das Modell rechnet
  useEffect(() => {
    if (!running || !recognizer || !catalogs) return;
    let active = true;
    stabilizer.current.reset();
    warmUpOcr(prefsRef.current.language === 'auto' ? ['latin', 'han'] : ['latin']);
    (async () => {
      await recognizer.ready;
      while (active) {
        if (questionRef.current) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        const { gameId } = prefsRef.current;
        const grabbed = videoRef.current && canvasRef.current ? grabCard(videoRef.current, canvasRef.current) : null;
        if (!grabbed || !gameId) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        const { matches, ms, vector, imageLanguages, shadow } = await recognizer.match(gameId, grabbed.frame, grabbed.guide, 8);
        if (!active) break;
        shadows.current = [...shadows.current, shadow].slice(-SHADOW_FRAMES);
        setShaded(shadows.current.length === SHADOW_FRAMES && shadows.current.every((s) => s >= SHADOW_HINT));
        const printings = catalogs.ordered.get(gameId) ?? [];
        const top = matches[0];
        // Bildähnlichkeit je Sprachfassung über die Frames desselben Treffers mitteln
        if (!top || imageEvidence.current.printing !== top.index) imageEvidence.current = { printing: top?.index ?? -1, frames: [] };
        imageEvidence.current.frames = [...imageEvidence.current.frames, imageLanguages].slice(-10);
        setGuess(top ? { printing: printings[top.index], score: top.score, ms } : null);
        const stable = stabilizer.current.push(matches);
        setCollecting(stable ? 0 : stabilizer.current.collected);
        setHolding(stabilizer.current.holding);
        if (stable) {
          const p = prefsRef.current;
          // Gibt es eigene Bilder je Sprache (z. B. chinesische Drucke), hilft das Bild, wenn der Text nicht eindeutig ist
          const frames = imageEvidence.current.printing === stable.index ? imageEvidence.current.frames : [];
          const averaged = (frames[0] ?? []).map((x, i) => ({ lang: x.lang, score: frames.reduce((sum, f) => sum + (f[i]?.score ?? 0), 0) / frames.length }));
          // Beide Ausschnitte aus demselben Kamerabild; ausgewertet wird erst, wenn die Karte feststeht
          const ocrCtx = drawCard(videoRef.current!, ocrCanvasRef.current!, OCR_CROP_HEIGHT);
          const shot = p.conditionAuto || p.finishAuto ? drawAroundCard(videoRef.current!, conditionCanvasRef.current!, CONDITION_CROP_HEIGHT, CONDITION_MARGIN) : null;
          const captured: Captured = {
            gameId,
            stable,
            vector,
            imageLanguage: languageFromImage(averaged, IMAGE_LANGUAGE_MARGIN),
            region: ocrCtx ? cropTextRegion(ocrCanvasRef.current!, document.createElement('canvas')) : null,
            card: ocrCtx ? copyCanvas(ocrCanvasRef.current!) : null,
            ocr: new Map(),
            timedOut: new Set(),
            shot,
            snapshot: ocrCtx ? snapshotOf(ocrCanvasRef.current!) : null,
          };
          const decision = await identify(captured);
          if (!active) break;
          if (decision.action === 'save') {
            await saveWithFx(captured, printings[decision.index], decision.via === 'image' ? 'auto' : 'text', true);
          } else {
            // Knapp: nicht raten, sondern nachfragen. Die Erkennung pausiert, bis du gewählt hast.
            recordAsked();
            navigator.vibrate?.([40, 60, 40]);
            const ask: Question = { captured, candidates: decision.candidates.map((i) => printings[i]), reason: decision.reason };
            questionRef.current = ask;
            setQuestion(ask);
          }
          if (!active) break;
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [running, recognizer, catalogs]);

  const undo = async (saved: Saved) => {
    await service.undo(saved.result);
    onAdded(-1, slotKey(saved.input.gameId, saved.input.printingId));
    if (saved.sample) await learning.forget(saved.sample.sampleId);
    setRecent((r) => r.filter((s) => s !== saved));
    stabilizer.current.reset();
    onChange();
    if (saved.sample?.source === 'auto') onLearn();
  };

  /** Scan mit geänderten Angaben neu speichern (nur dieses Exemplar, nicht schon vorhandene im selben Eintrag). */
  const resave = async (saved: Saved, patch: Partial<ScanInput>, overrides: Partial<Saved> = {}) => {
    await service.undo(saved.result);
    const input = { ...saved.input, ...patch };
    const result = await service.addScan(input);
    const old = saved.sample;
    const sample: Sample | undefined =
      old && (result.item.itemId !== old.itemId || patch.confirmed === false)
        ? { ...old, itemId: result.item.itemId, source: patch.confirmed === false ? 'pending' : old.source }
        : old;
    if (old && sample && sample !== old) await learning.reassign(old, sample.itemId!, sample.source);
    setRecent((r) => r.map((s) => (s === saved ? { ...s, result, input, sample, ...overrides } : s)));
    if (input.printingId !== saved.input.printingId) onMoved(slotKey(saved.input.gameId, saved.input.printingId), slotKey(input.gameId, input.printingId));
    onChange();
    if (old?.source === 'auto' && sample?.source !== 'auto') onLearn();
    return result;
  };

  /** Deine Bewertung eines automatisch gespeicherten Scans in die Genauigkeit einrechnen (jeder Scan zählt einmal). */
  const judge = (saved: Saved, verdict: Judgement): Saved['judged'] => {
    if (!saved.auto) return saved.judged;
    const { judged, patch } = judgeStats(saved.judged, verdict);
    if (patch) setStats(updateStats(patch));
    return judged;
  };

  /** Foil-Angabe bestätigt oder korrigiert: daraus lernt die Foil-Schwelle (nur wenn Foil am Foto bestimmt wurde). */
  const teachFoil = (saved: Saved, foil: boolean) => {
    if (saved.foilScore === undefined) return;
    setFoilShare(learnFoilShare(foilFeedback.add(saved.key, { score: saved.foilScore, foil })));
  };

  /** Sprache bestätigt oder korrigiert: daraus lernt, ab wann ein Druck ohne englischen Text als chinesisch gilt. */
  const teachLanguage = (saved: Saved, language: string) => {
    if (saved.latinScore === undefined) return;
    noLatinRef.current = learnNoLatin(languageFeedback.add(saved.key, { score: saved.latinScore, above: !isHanLanguage(language) }));
  };

  /** Zustand bestätigt oder korrigiert: daraus lernt, wie streng der Zustand geschätzt wird. */
  const teachCondition = (saved: Saved, condition: Condition) => {
    if (!saved.wear) return;
    conditionScaleRef.current = learnConditionScale(conditionFeedback.add(saved.key, { ...saved.wear, condition }));
  };

  /** Richtig erkannt (Karte, Sprache, Foil, Zustand): Der Scan wird zum eigenen Referenzbild und zählt als bestätigt. */
  const verify = async (saved: Saved) => {
    const judged = judge(saved, 'right');
    teachFoil(saved, saved.input.finish === 'foil');
    teachLanguage(saved, saved.input.language);
    teachCondition(saved, saved.input.condition);
    setRecent((r) => r.map((s) => (s === saved ? { ...s, verified: true, judged } : s)));
    if (saved.sample) {
      await learning.confirmItem(saved.result.item.itemId, saved.printing.printingId);
      onLearn();
    }
  };

  /** Foil/Normal korrigiert: zählt als Fehler und die Foil-Erkennung lernt daraus. */
  const correctFinish = (saved: Saved, finish: Finish) => {
    if (saved.input.finish === finish) return;
    teachFoil(saved, finish === 'foil');
    setFixing(null);
    return resave(saved, { finish }, { finishNote: undefined, judged: judge(saved, 'foil') });
  };

  /** Sprache korrigiert: zählt als Fehler, die Spracherkennung lernt daraus, folgende Karten nehmen sie als Vorgabe. */
  const correctLanguage = (saved: Saved, language: string) => {
    if (saved.input.language === language) return;
    lastLanguage.current = language;
    teachLanguage(saved, language);
    setFixing(null);
    return resave(saved, { language }, { languageNote: undefined, judged: judge(saved, 'language') });
  };

  /** Zustand korrigiert: zählt als Fehler (nur wenn er geschätzt war), die Zustandsschätzung lernt daraus. */
  const correctCondition = (saved: Saved, condition: Condition) => {
    if (saved.input.condition === condition) return;
    teachCondition(saved, condition);
    setFixing(null);
    return resave(saved, { condition }, { conditionNote: undefined, judged: saved.wear ? judge(saved, 'condition') : saved.judged });
  };

  /** Falsche Karte oder Variante: richtigen Druck speichern; der Scan wird sein Referenzbild. */
  const correctCard = async (saved: Saved, printing: Printing) => {
    setFixing(null);
    setFixQuery('');
    if (printing.printingId === saved.printing.printingId) return;
    const result = await resave(saved, { printingId: printing.printingId, confirmed: true }, { printing, judged: judge(saved, 'card'), verified: true });
    await learning.confirmItem(result.item.itemId, printing.printingId);
    onLearn();
  };

  /** Weiß gerade nicht, welche Karte es ist: unter „Prüfen“ ablegen. */
  const flag = (saved: Saved) => {
    setFixing(null);
    return resave(saved, { confirmed: false }, { flagged: true, judged: judge(saved, 'card') });
  };

  /** Antwort auf die Nachfrage: gewählte Karte speichern, oder (null) neu scannen. */
  const answer = async (printing: Printing | null) => {
    const q = questionRef.current;
    if (!q) return;
    setQuestion(null);
    setSearchQuery('');
    if (printing) await saveWithFx(q.captured, printing, 'chosen', false);
    else stabilizer.current.reset();
    // Erst jetzt weiterscannen, damit nicht zwei Auswertungen gleichzeitig laufen
    questionRef.current = null;
  };

  const languages = (gameId: string) => catalogs?.languages.get(gameId) ?? [];
  const searchCatalog = (gameId: string, query: string) => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return (catalogs?.ordered.get(gameId) ?? [])
      .filter((p) => `${p.cardName} ${nameIn(p, 'fr')} ${nameIn(p, 'zh-CN')} ${p.setCode} ${p.collectorNumber} ${p.setCode}-${p.collectorNumber}`.toLowerCase().includes(q))
      .slice(0, 12);
  };
  const candidateButtons = (list: Printing[], pick: (p: Printing) => void) => (
    <div class="candidates">
      {list.map((p) => (
        <button key={p.printingId} class="candidate" onClick={() => pick(p)}>
          <img src={p.imageUrl} alt={p.cardName} loading="lazy" />
          <small>{printingLabel(p)}</small>
        </button>
      ))}
    </div>
  );
  const chips = <T extends string>(label: string, options: { value: T; label: string }[], current: T, pick: (v: T) => void) => (
    <div class="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button role="radio" aria-checked={current === o.value} class={current === o.value ? 'active' : ''} onClick={() => pick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
  const languageChips = (s: Saved) =>
    chips('Sprache dieser Karte', languages(s.input.gameId).map((l) => ({ value: l.code, label: l.label })), s.input.language, (l) => correctLanguage(s, l));
  const conditionChips = (s: Saved) => chips('Zustand dieser Karte', CONDITIONS.map((c) => ({ value: c, label: c })), s.input.condition, (c) => correctCondition(s, c));
  const finishChips = (s: Saved) => chips('Foil dieser Karte', FINISHES, s.input.finish, (f) => correctFinish(s, f));

  /** Blatt, das von unten hereinfährt; ohne onClose schließt ein Tipp daneben es nicht. */
  const sheet = (cls: string, title: string, body: ComponentChildren, onClose?: () => void) => (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class={`sheet ${cls}`} role="dialog" aria-label={title}>
        <div class="grabber" />
        {body}
      </div>
    </>
  );

  /** „Falsch“: erst fragen, was falsch war, dann genau das korrigieren. */
  const renderFix = (s: Saved, kind: FixKind | null) => {
    const all = catalogs?.ordered.get(s.input.gameId) ?? [];
    const variants = all.filter((p) => p.cardName === s.printing.cardName && p.printingId !== s.printing.printingId);
    const kinds: { value: FixKind; label: string }[] = [
      { value: 'card', label: 'Karte' },
      ...(variants.length ? [{ value: 'variant' as const, label: 'Variante' }] : []),
      ...(languages(s.input.gameId).length > 1 ? [{ value: 'language' as const, label: 'Sprache' }] : []),
      { value: 'finish', label: 'Foil' },
      { value: 'condition', label: 'Zustand' },
    ];
    const byId = new Map(all.map((p) => [p.printingId, p]));
    const alternatives = (s.input.alternatives ?? []).map((id) => byId.get(id)).filter((p): p is Printing => !!p && p.printingId !== s.printing.printingId);
    const close = () => setFixing(null);
    return sheet(
      'fix',
      'Was war falsch?',
      <>
        <h2>Was war falsch?</h2>
        <p class="muted">{printingLabel(s.printing)}</p>
        {chips('Was war falsch', kinds, kind ?? ('' as FixKind), (k) => setFixing({ key: s.key, kind: k }))}
        {kind === 'card' && (
          <>
            {alternatives.length > 0 && candidateButtons(alternatives, (p) => correctCard(s, p))}
            <input type="search" placeholder="Name oder Nummer" value={fixQuery} onInput={(e) => setFixQuery(e.currentTarget.value)} />
            {candidateButtons(searchCatalog(s.input.gameId, fixQuery), (p) => correctCard(s, p))}
            <button onClick={() => flag(s)}>Später prüfen</button>
          </>
        )}
        {kind === 'variant' && candidateButtons(variants, (p) => correctCard(s, p))}
        {kind === 'language' && languageChips(s)}
        {kind === 'finish' && finishChips(s)}
        {kind === 'condition' && conditionChips(s)}
        <button class="ghost" onClick={close}>Abbrechen</button>
      </>,
      close,
    );
  };

  const gameLanguages = catalogs?.languages.get(prefs.gameId) ?? [];
  /** Was in den Einstellungen fest vorgegeben ist (sonst erkennt die App es selbst). */
  const fixedPrefs = [
    gameLanguages.length > 1 && prefs.language !== 'auto' ? gameLanguages.find((l) => l.code === prefs.language)?.label : undefined,
    prefs.finishAuto ? undefined : FINISHES.find((f) => f.value === prefs.finish)?.label,
    prefs.conditionAuto ? undefined : prefs.condition,
  ].filter((x): x is string => !!x);

  const [updateCheck, setUpdateCheck] = useState<'idle' | 'checking' | 'found' | 'none'>('idle');
  const checkForUpdate = async () => {
    setUpdateCheck('checking');
    setUpdateCheck((await updates.maybeCheck(true)) ? 'found' : 'none');
  };

  const renderSettings = () => {
    const close = () => setSettingsOpen(false);
    return sheet(
      'settings',
      'Einstellungen',
      <>
        <h2>Einstellungen</h2>
        {catalogs && catalogs.games.length > 1 && (
          <label class="field">
            <span>Spiel</span>
            <select value={prefs.gameId} onChange={(e) => setPrefs({ gameId: e.currentTarget.value })}>
              {catalogs.games.map((g) => <option value={g.gameId}>{g.gameName}</option>)}
            </select>
          </label>
        )}
        {gameLanguages.length > 1 && (
          <div class="field">
            <span>Sprache</span>
            {chips('Sprache der Karten', [{ value: 'auto', label: 'Automatisch' }, ...gameLanguages.map((l) => ({ value: l.code, label: l.label }))], prefs.language, (l) =>
              setPrefs({ language: l }),
            )}
          </div>
        )}
        <div class="field">
          <span>Licht</span>
          {chips('Kameralicht', [{ value: 'auto', label: 'Automatisch' }, { value: 'off', label: 'Nur von Hand' }], prefs.torchAuto ? 'auto' : 'off', (v) =>
            setPrefs({ torchAuto: v === 'auto' }),
          )}
        </div>
        <div class="field">
          <span>Foil</span>
          {chips('Foil', [{ value: 'auto', label: 'Automatisch' }, ...FINISHES], prefs.finishAuto ? 'auto' : prefs.finish, (v) =>
            setPrefs(v === 'auto' ? { finishAuto: true } : { finishAuto: false, finish: v as Finish }),
          )}
        </div>
        <div class="field">
          <span>Zustand</span>
          {chips('Zustand', [{ value: 'auto', label: 'Automatisch' }, ...CONDITIONS.map((c) => ({ value: c, label: c }))], prefs.conditionAuto ? 'auto' : prefs.condition, (v) =>
            setPrefs(v === 'auto' ? { conditionAuto: true } : { conditionAuto: false, condition: v as Condition }),
          )}
        </div>
        {accuracy && (
          <p class="muted stats">
            Genauigkeit: {accuracy} · Nachgefragt: {stats.asked}×
          </p>
        )}
        <p class="muted stats version">
          Version {APP_VERSION}{' '}
          <button class="link" disabled={updateCheck === 'checking'} onClick={checkForUpdate}>
            {updateCheck === 'checking' ? 'Suche …' : updateCheck === 'found' ? 'Update wird geladen …' : updateCheck === 'none' ? 'Neueste Version ✓' : 'Nach Updates suchen'}
          </button>
        </p>
        <button class="primary" onClick={close}>Fertig</button>
      </>,
      close,
    );
  };

  const sq = searchQuery.trim().toLowerCase();
  const searchResults =
    question && sq.length >= 2
      ? (catalogs?.ordered.get(question.captured.gameId) ?? [])
          .filter((p) =>
            `${p.cardName} ${nameIn(p, 'fr')} ${nameIn(p, 'zh-CN')} ${p.setCode} ${p.collectorNumber} ${p.setCode}-${p.collectorNumber}`.toLowerCase().includes(sq),
          )
          .slice(0, 12)
      : [];
  const accuracy = accuracyText(stats);

  const guide = box.w ? guideRect(box.w, box.h) : null;
  /** Aktueller Marktpreis eines Exemplars, formatiert (leer ohne Preis). */
  const priceOf = (item: CollectionItem, printing: Printing) => {
    const price = catalogs ? itemPrice(item, catalogs.price, printing) : undefined;
    return price === undefined ? '' : formatEur(price);
  };
  const addedPrice = added && recent[0] ? priceOf(recent[0].result.item, recent[0].printing) : '';
  const ready = !status && recognizer && catalogs;

  const fixed = fixing ? recent.find((s) => s.key === fixing.key) : undefined;

  return (
    <section class="scan">
      <div class="viewfinder" ref={viewfinderRef}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} hidden />
        <canvas ref={ocrCanvasRef} hidden />
        <canvas ref={conditionCanvasRef} hidden />
        <canvas ref={lumaCanvasRef} hidden />
        {running && guide && (
          <div ref={guideRef} class={`guide${holding ? ' done' : ''}`} style={{ left: guide.x, top: guide.y, width: guide.width, height: guide.height }} />
        )}
        <button class={`settings-button${fixedPrefs.length ? ' set' : ''}`} aria-label="Einstellungen" onClick={() => setSettingsOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4 7h10.2a3 3 0 0 1 5.6 0H20a1 1 0 1 1 0 2h-.2a3 3 0 0 1-5.6 0H4a1 1 0 0 1 0-2Zm13 1a1 1 0 1 0 0-.01ZM4 15h.2a3 3 0 0 1 5.6 0H20a1 1 0 1 1 0 2H9.8a3 3 0 0 1-5.6 0H4a1 1 0 1 1 0-2Zm3 1a1 1 0 1 0 0-.01Z"
            />
          </svg>
          {fixedPrefs.length > 0 && <span>{fixedPrefs.join(' · ')}</span>}
        </button>
        {running && torchAvailable && (
          <button
            class={`torch-button${torchOn ? ' on' : ''}`}
            aria-label={torchOn ? 'Licht aus' : 'Licht an'}
            aria-pressed={torchOn}
            onClick={() => { torchManual.current = true; void switchTorch(!torchOn); }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M13.4 2.2a.8.8 0 0 1 .6 1L12.6 10H18a.8.8 0 0 1 .6 1.3l-8 10.4a.8.8 0 0 1-1.4-.7L10.6 14H6a.8.8 0 0 1-.6-1.3l7.2-10.2a.8.8 0 0 1 .8-.3Z" />
            </svg>
          </button>
        )}
        {!running && (
          <div class="overlay">
            <div class="frame" aria-hidden="true">
              <svg viewBox="0 0 63 88" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 18V8a6 6 0 0 1 6-6h10M45 2h10a6 6 0 0 1 6 6v10M61 70v10a6 6 0 0 1-6 6H45M18 86H8a6 6 0 0 1-6-6V70" />
              </svg>
              {ready && <span />}
            </div>
            {camError && <p class="banner error">{camError}</p>}
            <button class="primary big" disabled={!ready} onClick={() => { setCamError(null); setRunning(true); }}>
              Scannen starten
            </button>
            {!ready && (
              <p class={`status${status.startsWith('Fehler') ? ' error' : ''}`} role="status">
                {!status.startsWith('Fehler') && <span class="spinner" />}
                {status || 'Lade …'}
              </p>
            )}
          </div>
        )}
        {running && (
          <div class="hud">
            {reading ? (
              <span>{reading === 'han' ? 'Lese chinesischen Text …' : 'Lese Kartentext …'}</span>
            ) : analyzing ? (
              <span>Prüfe Sprache, Zustand und Foil …</span>
            ) : question ? (
              <span>Welche Karte ist es?</span>
            ) : added ? (
              <span class="added">
                ✓ {added} hinzugefügt{addedPrice && <b> · {addedPrice}</b>}
              </span>
            ) : holding ? (
              <span>Gespeichert. Nächste Karte.</span>
            ) : shaded ? (
              <span>{torchAvailable && !torchOn ? 'Schatten auf der Karte. Tippe auf den Blitz.' : 'Schatten auf der Karte.'}</span>
            ) : collecting > DEFAULT_STABILIZER.requiredFrames ? (
              <span>Karte ruhig halten …</span>
            ) : guess ? (
              <span>
                {guess.printing.cardName} · {Math.round(guess.score * 100)} %
              </span>
            ) : dark ? (
              <span>{torchAvailable ? 'Zu dunkel. Tippe auf den Blitz.' : 'Zu dunkel. Bitte mehr Licht.'}</span>
            ) : (
              <span>Karte in den Rahmen halten</span>
            )}
            <button onClick={() => setRunning(false)}>Stopp</button>
          </div>
        )}
      </div>

      {question &&
        sheet(
          'ask',
          'Welche Karte ist es?',
          <>
            <h2>Welche Karte ist es?</h2>
            <p class="muted">
              {question.reason === 'conflict'
                ? 'Bild und Text passen nicht zusammen'
                : question.reason === 'variant'
                  ? 'Variante unklar'
                  : `${Math.round(question.captured.stable.confidence * 100)} % sicher`}
            </p>
            {candidateButtons(question.candidates, (p) => answer(p))}
            <input type="search" placeholder="Name oder Nummer" value={searchQuery} onInput={(e) => setSearchQuery(e.currentTarget.value)} />
            {searchResults.length > 0 && candidateButtons(searchResults, (p) => answer(p))}
            <button class="ghost" onClick={() => answer(null)}>Nicht speichern, neu scannen</button>
          </>,
        )}

      {fixing && fixed && renderFix(fixed, fixing.kind)}
      {settingsOpen && renderSettings()}

      {recent.length > 0 && (
        <div class="section-title">
          <h2>Zuletzt gescannt</h2>
          <small class="muted">{recent.reduce((n, s) => n + s.result.item.quantity, 0)} Karten</small>
        </div>
      )}
      {recent.length > 0 && (
        <ul class="recent">
          {recent.map((s) => {
            const item = s.result.item;
            const language = catalogs?.languages.get(item.gameId)?.find((l) => l.code === item.language)?.label;
            const canVerify = s.auto && item.confirmed && !s.flagged && !s.judged;
            const canFix = item.confirmed && !s.flagged;
            const open = details === s.key;
            return (
              <li key={item.itemId + item.quantity}>
                <div class="main">
                  <img src={thumb(s.printing)} alt="" loading="lazy" />
                  <span class="info">
                    <strong>{s.printing.cardName}</strong>
                    <small>
                      {printingCode(s.printing)} · {language} · ×{item.quantity}
                    </small>
                    {(item.finish === 'foil' || !item.confirmed || s.verified || s.languageNote?.startsWith('Sprache unsicher')) && (
                      <span class="line">
                        {item.finish === 'foil' && <em class="tag foil">Foil</em>}
                        {!item.confirmed && <em class="tag warn">Liegt unter „Prüfen“</em>}
                        {s.verified && <em class="tag up">✓ bestätigt</em>}
                        {!s.verified && s.languageNote?.startsWith('Sprache unsicher') && <em class="tag warn">Sprache unsicher</em>}
                      </span>
                    )}
                  </span>
                  {priceOf(item, s.printing) && <span class="price">{priceOf(item, s.printing)}</span>}
                  <button class={`icon${open ? ' open' : ''}`} aria-label="Details" aria-expanded={open} onClick={() => setDetails(open ? null : s.key)}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                </div>
                {(canVerify || canFix) && (
                  <div class="verdict">
                    {canVerify && <button class="primary" onClick={() => verify(s)}>Richtig</button>}
                    {canFix && (
                      <button
                        aria-expanded={fixing?.key === s.key}
                        onClick={() => {
                          setFixQuery('');
                          setFixing({ key: s.key, kind: null });
                        }}
                      >
                        Falsch
                      </button>
                    )}
                  </div>
                )}
                {open && (
                  <div class="details">
                    <small>
                      Zustand {item.condition}
                      {s.confidence !== undefined && ` · ${Math.floor(s.confidence * 100)} % sicher${s.byText ? ' (Text gelesen)' : ''}`}
                      {s.auto === false && ' · von dir gewählt'}
                    </small>
                    {s.languageNote && <small class="note">{s.languageNote}</small>}
                    {s.finishNote && <small class="note">{s.finishNote}</small>}
                    {s.conditionNote && <small class="note">{s.conditionNote}</small>}
                    <button class="ghost" onClick={() => undo(s)}>Rückgängig</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
