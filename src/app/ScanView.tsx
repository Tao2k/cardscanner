import { useEffect, useRef, useState } from 'preact/hooks';
import type { AddResult, CollectionService, ScanInput } from '../core/collection';
import type { LearningService, Sample } from '../core/learning';
import { guideRect } from '../core/geometry';
import { Stabilizer } from '../core/stabilizer';
import type { Condition, Printing } from '../core/types';
import type { Catalogs } from './App';
import { CONDITION_CROP_HEIGHT, drawAroundCard, drawCard, grabCard, OCR_CROP_HEIGHT, startCamera, stopCamera } from './camera';
import { CONDITION_MARGIN, type ConditionEstimate } from '../core/condition';
import { estimateFromCanvas } from './condition';
import { detectLanguage, IMAGE_LANGUAGE_MARGIN, languageFromImage } from '../core/language';
import { cropTextRegion, readText, warmUpOcr } from './ocr';
import type { Prefs } from './prefs';
import type { Recognizer } from './recognizer';
import { printingLabel } from './format';

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

interface Saved {
  result: AddResult;
  printing: Printing;
  input: ScanInput;
  sample?: Sample;
  /** „Falsch erkannt“ wurde gedrückt, der Scan liegt jetzt unter „Prüfen“. */
  flagged?: boolean;
  /** Ob der Zustand geschätzt wurde, sonst warum nicht. */
  conditionNote?: string;
  /** Gesetzt, wenn die Sprache nicht erkannt, sondern angenommen wurde. */
  languageNote?: string;
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

  // Erkennungsschleife: ein Frame nach dem anderen, so schnell wie das Modell rechnet
  useEffect(() => {
    if (!running || !recognizer || !catalogs) return;
    let active = true;
    stabilizer.current.reset();
    if (prefsRef.current.language === 'auto') warmUpOcr();
    (async () => {
      await recognizer.ready;
      while (active) {
        const { gameId } = prefsRef.current;
        const pixels = videoRef.current && canvasRef.current ? grabCard(videoRef.current, canvasRef.current) : null;
        if (!pixels || !gameId) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        const { matches, ms, vector, imageLanguages } = await recognizer.match(gameId, pixels);
        if (!active) break;
        const printings = catalogs.ordered.get(gameId) ?? [];
        const top = matches[0];
        // Bildähnlichkeit je Sprachfassung über die Frames desselben Treffers mitteln
        if (!top || imageEvidence.current.printing !== top.index) imageEvidence.current = { printing: top?.index ?? -1, frames: [] };
        imageEvidence.current.frames = [...imageEvidence.current.frames, imageLanguages].slice(-10);
        setGuess(top ? { printing: printings[top.index], score: top.score, ms } : null);
        const stable = stabilizer.current.push(matches);
        if (stable) {
          const p = prefsRef.current;
          const printing = printings[stable.index];
          const languages = catalogs.languages.get(gameId)?.map((l) => l.code) ?? ['en'];
          const autoLanguage = p.language === 'auto' || !languages.includes(p.language);
          // Gibt es eigene Bilder je Sprache (z. B. chinesische Drucke), hilft das Bild, wenn der Text nicht eindeutig ist
          const frames = imageEvidence.current.printing === stable.index ? imageEvidence.current.frames : [];
          const averaged = (frames[0] ?? []).map((x, i) => ({ lang: x.lang, score: frames.reduce((sum, f) => sum + (f[i]?.score ?? 0), 0) / frames.length }));
          const imageLanguage = languageFromImage(averaged, IMAGE_LANGUAGE_MARGIN);
          // Beide Ausschnitte aus demselben Kamerabild, danach Texterkennung und Zustand parallel
          const ocrCtx = autoLanguage ? drawCard(videoRef.current!, ocrCanvasRef.current!, OCR_CROP_HEIGHT) : null;
          const shot = p.conditionAuto ? drawAroundCard(videoRef.current!, conditionCanvasRef.current!, CONDITION_CROP_HEIGHT, CONDITION_MARGIN) : null;
          const region = ocrCtx ? cropTextRegion(ocrCanvasRef.current!, document.createElement('canvas')) : null;
          setAnalyzing(true);
          const [languageGuess, conditionGuess] = await Promise.all([
            autoLanguage && region
              ? detectLanguage((script) => readText(region!, script), printing.texts ?? {}, languages)
              : Promise.resolve(null),
            shot
              ? estimateFromCanvas(shot.ctx, shot.guide, catalogs.grayRefs(gameId, printing.printingId)).catch(
                  (e: Error): ConditionEstimate => ({ condition: null, reason: e.message, edge: 0, corner: 0, fit: 0 }),
                )
              : Promise.resolve(null),
          ]);
          setAnalyzing(false);
          if (!active) break;
          let language = p.language;
          let languageNote: string | undefined;
          if (autoLanguage) {
            // Reihenfolge: gelesener Text, dann Bild, dann die zuletzt erkannte Sprache (Stapel sind meist einsprachig)
            const detected = languageGuess?.lang ?? imageLanguage;
            language = detected ?? lastLanguage.current ?? languages[0];
            if (!detected) languageNote = `Sprache nicht sicher erkannt, angenommen: ${labelOf(gameId, language)}`;
            if (detected) lastLanguage.current = detected;
          }
          const condition = conditionGuess?.condition ?? p.condition;
          const conditionNote = !p.conditionAuto
            ? undefined
            : conditionGuess?.condition
              ? 'Zustand geschätzt'
              : `Zustand nicht geschätzt (${conditionGuess?.reason ?? 'unbekannt'}), Standard ${p.condition}`;
          const input: ScanInput = {
            gameId,
            printingId: printing.printingId,
            language,
            finish: p.finish,
            condition,
            location: p.location,
            confirmed: stable.confident,
            matchScore: stable.score,
            alternatives: stable.alternatives.map((i) => printings[i].printingId),
          };
          const result = await service.addScan(input);
          // Den Scan merken: bestätigst oder korrigierst du ihn später, lernt die Erkennung daraus
          const sample = vector
            ? await learning
                .recordScan({ gameId, printingId: printing.printingId, itemId: result.item.itemId, vector, confident: stable.confident })
                .catch(() => undefined)
            : undefined;
          navigator.vibrate?.(stable.confident ? 40 : [40, 60, 40]);
          setRecent((r) => [{ result, printing, input, sample, conditionNote, languageNote }, ...r].slice(0, 5));
          onChange();
          if (sample?.source === 'auto') onLearn();
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

  /** Sicher gespeichert, aber falsch: Scan als unsicher unter „Prüfen“ ablegen, dort die richtige Karte wählen. */
  const flag = (saved: Saved) => resave(saved, { confirmed: false }, { flagged: true });

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
            {analyzing ? (
              <span>Prüfe Sprache und Zustand …</span>
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
        <label class="toggle">
          <input type="checkbox" checked={prefs.finish === 'foil'} onChange={(e) => setPrefs({ finish: e.currentTarget.checked ? 'foil' : 'normal' })} />
          Foil
        </label>
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
        <input
          placeholder="Lagerort (z. B. Binder 1)"
          value={prefs.location}
          onChange={(e) => setPrefs({ location: e.currentTarget.value })}
        />
      </div>

      {recent.length > 0 && (
        <ul class="recent">
          {recent.map((s, i) => (
            <li key={s.result.item.itemId + s.result.item.quantity}>
              <img src={thumb(s.printing)} alt="" loading="lazy" />
              <span>
                {printingLabel(s.printing)}
                <small> · {catalogs?.languages.get(s.result.item.gameId)?.find((l) => l.code === s.result.item.language)?.label}</small>
                {!s.result.item.confirmed && <em> · prüfen</em>}
                <small> ×{s.result.item.quantity}</small>
              </span>
              {s.result.item.confirmed && !s.flagged && <button onClick={() => flag(s)}>Falsch</button>}
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
              {i === 0 && s.languageNote && <small class="note warn">{s.languageNote}</small>}
              {i === 0 && s.conditionNote && <small class="note">{s.conditionNote}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
