import { useEffect, useRef, useState } from 'preact/hooks';
import type { AddResult, CollectionService, ScanInput } from '../core/collection';
import type { LearningService, Sample } from '../core/learning';
import { guideRect } from '../core/geometry';
import type { Condition, Finish, Printing } from '../core/types';
import type { Catalogs } from './App';
import { CONDITION_CROP_HEIGHT, drawAroundCard, drawCard, grabCard, OCR_CROP_HEIGHT, startCamera, stopCamera } from './camera';
import { CONDITION_MARGIN } from '../core/condition';
import { finishesOf, learnFoilShare } from '../core/foil';
import { addFoilFeedback, loadFoilFeedback } from './foilFeedback';
import { analyzeCanvas, type CardAnalysis } from './analyze';
import { detectLanguage, IMAGE_LANGUAGE_MARGIN, languageFromImage } from '../core/language';
import { cropTextRegion, readText, warmUpOcr, type Script } from './ocr';
import { buildTextIndex, decide, matchText, TEXT_CONFIDENCE, textWinner, type Decision, type TextIndex, type TextMatch } from '../core/textmatch';
import type { Prefs } from './prefs';
import type { Recognizer } from './recognizer';
import { printingLabel } from './format';
import { DEFAULT_STABILIZER, Stabilizer, type StableResult } from '../core/stabilizer';
import { accuracyText, loadStats, strictness, updateStats } from './stats';
import { nameIn } from '../core/catalog';

interface Props {
  catalogs: Catalogs | null;
  recognizer: Recognizer | null;
  status: string;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  service: CollectionService;
  learning: LearningService;
  onChange(): void;
  /** Eigene Scans haben sich geändert; die Erkennung soll sie neu einlesen. */
  onLearn(): void;
}

/** Immer das englische Kartenbild, auch bei chinesischen Drucken. */
const thumb = (p: Printing) => p.thumbUrl ?? p.imageUrl;

const CONDITIONS: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];
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
  /** Deine Bewertung (zählt einmal in der Genauigkeit). */
  judged?: 'right' | 'wrong';
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
}

/** Was im Moment des Treffers aufgenommen wurde; ausgewertet wird, sobald die Karte feststeht. */
interface Captured {
  gameId: string;
  stable: StableResult;
  vector: Float32Array | null;
  imageLanguage: string | null;
  region: HTMLCanvasElement | null;
  /** Gelesener Text je Schrift, einmal gelesen für Erkennung und Sprache. */
  ocr: Map<Script, Promise<string>>;
  shot: { ctx: CanvasRenderingContext2D; guide: { x: number; y: number; width: number; height: number } } | null;
}

/** Knapper Treffer: Kandidaten zum Antippen. */
interface Question {
  captured: Captured;
  candidates: Printing[];
  /** unsure = zu knapp; conflict = Bild und Text sagen verschiedene Karten; variant = Karte klar, Variante nicht. */
  reason: 'unsure' | 'conflict' | 'variant';
}

/** Text einmal lesen, danach aus dem Zwischenspeicher. */
function readOnce(captured: Captured, script: Script): Promise<string> {
  if (!captured.region) return Promise.resolve('');
  let text = captured.ocr.get(script);
  if (!text) {
    text = readText(captured.region, script);
    captured.ocr.set(script, text);
  }
  return text;
}

export function ScanView({ catalogs, recognizer, status, prefs, setPrefs, service, learning, onChange, onLearn }: Props) {
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
  const [reading, setReading] = useState(false);
  const textIndexes = useRef(new Map<string, TextIndex>());
  const [question, setQuestion] = useState<Question | null>(null);
  const questionRef = useRef<Question | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collecting, setCollecting] = useState(0);
  const [stats, setStats] = useState(loadStats);
  // Foil-Schwelle, gelernt aus deinen Foil-Bestätigungen und -Korrekturen
  const [foilShare, setFoilShare] = useState(() => learnFoilShare(loadFoilFeedback()));
  const foilShareRef = useRef(foilShare);
  foilShareRef.current = foilShare;
  const recordAuto = () => setStats(updateStats((s) => ({ auto: s.auto + 1 })));
  // Meldest du viele Fehler, verlangt der Scanner mehr Abstand, bevor er ohne Nachfrage speichert
  const extraMargin = strictness(stats);
  useEffect(() => {
    stabilizer.current = new Stabilizer({ ...DEFAULT_STABILIZER, confidentMargin: DEFAULT_STABILIZER.confidentMargin + extraMargin });
  }, [extraMargin]);
  const recordAsked = () => setStats(updateStats((s) => ({ asked: s.asked + 1 })));
  const ocrCanvasRef = useRef<HTMLCanvasElement>(null);
  const conditionCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Zuletzt erkannte Sprache; Fallback, wenn der Text nicht eindeutig ist (Stapel sind meist einsprachig). */
  const lastLanguage = useRef<string | null>(null);
  const labelOf = (gameId: string, code: string) => catalogs?.languages.get(gameId)?.find((l) => l.code === code)?.label ?? code;
  const imageEvidence = useRef<{ printing: number; frames: { lang: string; score: number }[][] }>({ printing: -1, frames: [] });

  // Kamera starten/stoppen
  useEffect(() => {
    if (!running) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    startCamera(videoRef.current!)
      .then((s) => {
        stream = s;
        if (cancelled) stopCamera(s);
        const v = videoRef.current!;
        setBox({ w: v.clientWidth, h: v.clientHeight });
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
      stopCamera(stream);
    };
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
    const [languageGuess, analysis] = await Promise.all([
      autoLanguage && region
        ? detectLanguage((script) => readOnce(captured, script), printing.texts ?? {}, languages)
        : Promise.resolve(null),
      shot
        ? analyzeCanvas(shot.ctx, shot.guide, catalogs.compareRefs(gameId, printing.printingId), foilShareRef.current).catch(
            (e: Error): CardAnalysis => ({ condition: { condition: null, reason: e.message, edge: 0, corner: 0, fit: 0 }, foil: null }),
          )
        : Promise.resolve(null),
    ]);
    setAnalyzing(false);
    let language = p.language;
    let languageNote: string | undefined;
    if (autoLanguage) {
      // Reihenfolge: gelesener Text, dann Bild, dann die zuletzt erkannte Sprache (Stapel sind meist einsprachig)
      const detected = languageGuess?.lang ?? imageLanguage;
      language = detected ?? lastLanguage.current ?? languages[0];
      if (!detected) languageNote = `Sprache nicht sicher erkannt, angenommen: ${labelOf(gameId, language)}`;
      if (detected) lastLanguage.current = detected;
    }
    const conditionGuess = p.conditionAuto ? analysis?.condition : undefined;
    const condition = conditionGuess?.condition ?? p.condition;
    const conditionNote = !p.conditionAuto
      ? undefined
      : conditionGuess?.condition
        ? 'Zustand geschätzt'
        : `Zustand nicht geschätzt (${conditionGuess?.reason ?? 'unbekannt'}), Standard ${p.condition}`;
    // Foil: gibt es den Druck nur in einer Ausführung, steht sie fest; sonst entscheidet das Foto
    let finish = p.finish;
    let finishNote: string | undefined;
    let foilScore: number | undefined;
    if (p.finishAuto) {
      const finishes = finishesOf(printing);
      const foil = analysis?.foil;
      if (finishes.length === 1) {
        finish = finishes[0];
        finishNote = finish === 'foil' ? 'Foil (gibt es nur als Foil)' : undefined;
      } else if (foil && foil.foil !== null) {
        finish = foil.foil ? 'foil' : 'normal';
        finishNote = `${foil.foil ? 'Foil erkannt' : 'Kein Foil erkannt'} (Schimmer ${Math.round(foil.score * 100)} %, Foil ab ${Math.round(foilShareRef.current * 100)} %). Falsch? Unten tippen, daraus lernt die Erkennung.`;
        foilScore = foil.score;
      } else {
        finishNote = `Foil nicht geprüft, Karte nicht sicher gefunden; Standard ${p.finish === 'foil' ? 'Foil' : 'Normal'}`;
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
    // Den Scan merken: bestätigst oder korrigierst du ihn später, lernt die Erkennung daraus
    const sample = vector
      ? await learning
          .recordScan({ gameId, printingId: printing.printingId, itemId: result.item.itemId, vector, confident: true })
          .catch(() => undefined)
      : undefined;
    // Von dir gewählt: Der Scan wird sofort zum eigenen Referenzbild
    if (how === 'chosen' && sample) {
      await learning.confirmItem(result.item.itemId, printing.printingId);
      sample.source = 'user';
    }
    if (how !== 'chosen') recordAuto();
    navigator.vibrate?.(40);
    setRecent((r) => [{ result, printing, input, sample, conditionNote, languageNote, finishNote, auto: how !== 'chosen', confidence: how === 'auto' ? stable.confidence : how === 'text' ? TEXT_CONFIDENCE : undefined, byText: how === 'text', foilScore, key: `${result.item.itemId}-${Date.now()}` }, ...r].slice(0, 5));
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
      setReading(true);
      const latin = await readOnce(captured, 'latin');
      text = matchText(index, { latin });
      const hasHan = catalogs?.languages.get(gameId)?.some((l) => l.code.startsWith('zh'));
      if (!stable.confident && hasHan && !textWinner(text)) text = matchText(index, { latin, han: await readOnce(captured, 'han') });
      setReading(false);
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
        const pixels = videoRef.current && canvasRef.current ? grabCard(videoRef.current, canvasRef.current) : null;
        if (!pixels || !gameId) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        const { matches, ms, vector, imageLanguages } = await recognizer.match(gameId, pixels, 8);
        if (!active) break;
        const printings = catalogs.ordered.get(gameId) ?? [];
        const top = matches[0];
        // Bildähnlichkeit je Sprachfassung über die Frames desselben Treffers mitteln
        if (!top || imageEvidence.current.printing !== top.index) imageEvidence.current = { printing: top?.index ?? -1, frames: [] };
        imageEvidence.current.frames = [...imageEvidence.current.frames, imageLanguages].slice(-10);
        setGuess(top ? { printing: printings[top.index], score: top.score, ms } : null);
        const stable = stabilizer.current.push(matches);
        setCollecting(stable ? 0 : stabilizer.current.collected);
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
            ocr: new Map(),
            shot,
          };
          const decision = await identify(captured);
          if (!active) break;
          if (decision.action === 'save') {
            await saveScan(captured, printings[decision.index], decision.via === 'text' ? 'text' : 'auto');
          } else {
            // Knapp: nicht raten, sondern nachfragen. Die Erkennung pausiert, bis du gewählt hast.
            recordAsked();
            navigator.vibrate?.([40, 60, 40]);
            const index = textIndexFor(gameId);
            const sameCard = decision.candidates.every((i) => index.groupOf[i] === index.groupOf[decision.candidates[0]]);
            const reason = decision.reason === 'conflict' ? 'conflict' : sameCard ? 'variant' : 'unsure';
            const ask: Question = { captured, candidates: decision.candidates.map((i) => printings[i]), reason };
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
    onChange();
    if (old?.source === 'auto' && sample?.source !== 'auto') onLearn();
  };

  /**
   * Deine Bewertung eines automatisch gespeicherten Scans in die Genauigkeit einrechnen (jeder Scan zählt
   * einmal; „falsch“ überschreibt ein früheres „richtig“). kind: falsche Karte oder nur Foil falsch.
   */
  const judge = (saved: Saved, verdict: 'right' | 'wrong', kind: 'card' | 'foil' = 'card'): Saved['judged'] => {
    if (!saved.auto || saved.judged === 'wrong' || saved.judged === verdict) return saved.judged;
    setStats(
      updateStats((s) =>
        verdict === 'right'
          ? { right: s.right + 1 }
          : { right: s.right - (saved.judged === 'right' ? 1 : 0), ...(kind === 'card' ? { wrong: s.wrong + 1 } : { foilWrong: s.foilWrong + 1 }) },
      ),
    );
    return verdict;
  };

  /** Foil-Angabe bestätigt oder korrigiert: daraus lernt die Foil-Schwelle (nur wenn Foil am Foto bestimmt wurde). */
  const teachFoil = (saved: Saved, foil: boolean) => {
    if (saved.foilScore === undefined) return;
    setFoilShare(learnFoilShare(addFoilFeedback(saved.key, { score: saved.foilScore, foil })));
  };

  /** Sicher gespeichert, aber falsch: Scan als unsicher unter „Prüfen“ ablegen, dort die richtige Karte wählen. */
  const flag = (saved: Saved) => resave(saved, { confirmed: false }, { flagged: true, judged: judge(saved, 'wrong') });

  /** Richtig erkannt (Karte und Foil): Der Scan wird zum eigenen Referenzbild und zählt als bestätigt. */
  const verify = async (saved: Saved) => {
    const judged = judge(saved, 'right');
    teachFoil(saved, saved.input.finish === 'foil');
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
    return resave(saved, { finish }, { finishNote: undefined, judged: judge(saved, 'wrong', 'foil') });
  };

  /** Antwort auf die Nachfrage: gewählte Karte speichern, oder (null) neu scannen. */
  const answer = async (printing: Printing | null) => {
    const q = questionRef.current;
    if (!q) return;
    setQuestion(null);
    setSearchQuery('');
    if (printing) await saveScan(q.captured, printing, 'chosen');
    else stabilizer.current.reset();
    // Erst jetzt weiterscannen, damit nicht zwei Auswertungen gleichzeitig laufen
    questionRef.current = null;
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
  const ready = !status && recognizer && catalogs;

  return (
    <section class="scan">
      <div class="viewfinder">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} hidden />
        <canvas ref={ocrCanvasRef} hidden />
        <canvas ref={conditionCanvasRef} hidden />
        {running && guide && (
          <div class="guide" style={{ left: guide.x, top: guide.y, width: guide.width, height: guide.height }} />
        )}
        {!running && (
          <div class="overlay">
            {camError && <p class="banner error">{camError}</p>}
            <button class="primary big" disabled={!ready} onClick={() => { setCamError(null); setRunning(true); }}>
              {ready ? 'Scannen starten' : status || 'Lade …'}
            </button>
          </div>
        )}
        {running && (
          <div class="hud">
            {reading ? (
              <span>Lese Kartentext …</span>
            ) : analyzing ? (
              <span>Prüfe Sprache, Zustand und Foil …</span>
            ) : question ? (
              <span>Welche Karte ist es? Bitte unten antippen.</span>
            ) : collecting > DEFAULT_STABILIZER.requiredFrames ? (
              <span>Noch unsicher, Karte ruhig halten …</span>
            ) : guess ? (
              <span>
                {guess.printing.cardName} · {Math.round(guess.score * 100)} % · {guess.ms} ms
              </span>
            ) : (
              <span>Karte in den Rahmen halten</span>
            )}
            <button onClick={() => setRunning(false)}>Stopp</button>
          </div>
        )}
      </div>

      {question && (
        <div class="ask">
          <p>
            <strong>
              {question.reason === 'conflict'
                ? 'Bild und Kartentext passen nicht zur selben Karte.'
                : question.reason === 'variant'
                  ? 'Karte am Text erkannt, aber nicht welche Variante.'
                  : `Nur zu etwa ${Math.round(question.captured.stable.confidence * 100)} % sicher, welche Karte das ist.`}
            </strong>{' '}
            Gespeichert wird erst ab 95 %. Tippe auf die richtige, daraus lernt die Erkennung.
          </p>
          <div class="candidates">
            {question.candidates.map((p) => (
              <button key={p.printingId} class="candidate" onClick={() => answer(p)}>
                <img src={p.imageUrl} alt={p.cardName} loading="lazy" />
                <small>{printingLabel(p)}</small>
              </button>
            ))}
          </div>
          <input type="search" placeholder="Keine davon? Name oder Nummer suchen" value={searchQuery} onInput={(e) => setSearchQuery(e.currentTarget.value)} />
          {searchResults.length > 0 && (
            <div class="candidates">
              {searchResults.map((p) => (
                <button key={p.printingId} class="candidate" onClick={() => answer(p)}>
                  <img src={p.imageUrl} alt={p.cardName} loading="lazy" />
                  <small>{printingLabel(p)}</small>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => answer(null)}>Nicht speichern, neu scannen</button>
        </div>
      )}

      <div class="controls">
        {catalogs && catalogs.games.length > 1 && (
          <select value={prefs.gameId} onChange={(e) => setPrefs({ gameId: e.currentTarget.value })}>
            {catalogs.games.map((g) => <option value={g.gameId}>{g.gameName}</option>)}
          </select>
        )}
        {catalogs && (catalogs.languages.get(prefs.gameId)?.length ?? 0) > 1 && (
          <div class="segmented" role="radiogroup" aria-label="Sprache der Karten">
            {[{ code: 'auto', label: 'Auto' }, ...catalogs.languages.get(prefs.gameId)!].map((l) => (
              <button
                role="radio"
                aria-checked={prefs.language === l.code}
                class={prefs.language === l.code ? 'active' : ''}
                onClick={() => setPrefs({ language: l.code })}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
        <select
          aria-label="Foil"
          value={prefs.finishAuto ? 'auto' : prefs.finish}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setPrefs(v === 'auto' ? { finishAuto: true } : { finishAuto: false, finish: v as Finish });
          }}
        >
          <option value="auto">Foil: Auto</option>
          {FINISHES.map((f) => <option value={f.value}>{f.label}</option>)}
        </select>
        <select
          aria-label="Zustand"
          value={prefs.conditionAuto ? 'auto' : prefs.condition}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setPrefs(v === 'auto' ? { conditionAuto: true } : { conditionAuto: false, condition: v as Condition });
          }}
        >
          <option value="auto">Zustand: Auto</option>
          {CONDITIONS.map((c) => <option value={c}>{c}</option>)}
        </select>
      </div>

      {accuracy && (
        <p class="muted stats">
          Genauigkeit bisher: {accuracy}. Nachgefragt: {stats.asked}×.
          {extraMargin > 0 && ' Wegen gemeldeter Fehler fragt der Scanner jetzt öfter nach.'}
        </p>
      )}

      {recent.length > 0 && (
        <ul class="recent">
          {recent.map((s, i) => (
            <li key={s.result.item.itemId + s.result.item.quantity}>
              <img src={thumb(s.printing)} alt="" loading="lazy" />
              <span>
                {printingLabel(s.printing)}
                <small> · {catalogs?.languages.get(s.result.item.gameId)?.find((l) => l.code === s.result.item.language)?.label}{s.result.item.finish === 'foil' ? ' · Foil' : ''}</small>
                {!s.result.item.confirmed && <em> · prüfen</em>}
                {s.confidence !== undefined && <small> · {Math.floor(s.confidence * 100)} % sicher{s.byText ? ' (am Text erkannt)' : ''}</small>}
                {s.auto === false && <small> · von dir gewählt</small>}
                <small> ×{s.result.item.quantity}</small>
              </span>
              {s.auto && s.result.item.confirmed && !s.flagged && !s.judged && <button onClick={() => verify(s)}>Richtig</button>}
              {s.auto && s.result.item.confirmed && !s.flagged && !s.verified && <button onClick={() => flag(s)}>Falsch</button>}
              {s.verified && <small> · ✓ bestätigt</small>}
              <button onClick={() => undo(s)}>Rückgängig</button>
              {i === 0 && (catalogs?.languages.get(s.input.gameId)?.length ?? 0) > 1 && (
                <div class="segmented condition" role="radiogroup" aria-label="Sprache dieser Karte">
                  {catalogs!.languages.get(s.input.gameId)!.map((l) => (
                    <button
                      role="radio"
                      aria-checked={s.input.language === l.code}
                      class={s.input.language === l.code ? 'active' : ''}
                      onClick={() => {
                        if (s.input.language === l.code) return;
                        lastLanguage.current = l.code;
                        resave(s, { language: l.code }, { languageNote: undefined });
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              {i === 0 && (
                <div class="segmented condition" role="radiogroup" aria-label="Zustand dieser Karte">
                  {CONDITIONS.map((c) => (
                    <button
                      role="radio"
                      aria-checked={s.input.condition === c}
                      class={s.input.condition === c ? 'active' : ''}
                      onClick={() => s.input.condition !== c && resave(s, { condition: c }, { conditionNote: undefined })}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {i === 0 && (
                <div class="segmented condition" role="radiogroup" aria-label="Foil dieser Karte">
                  {FINISHES.map((f) => (
                    <button
                      role="radio"
                      aria-checked={s.input.finish === f.value}
                      class={s.input.finish === f.value ? 'active' : ''}
                      onClick={() => correctFinish(s, f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              {i === 0 && s.languageNote && <small class="note warn">{s.languageNote}</small>}
              {i === 0 && s.finishNote && <small class="note">{s.finishNote}</small>}
              {i === 0 && s.conditionNote && <small class="note">{s.conditionNote}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
