import { useEffect, useRef, useState } from 'preact/hooks';
import type { AddResult, CollectionService, ScanInput } from '../core/collection';
import type { LearningService, Sample } from '../core/learning';
import { guideRect } from '../core/geometry';
import { Stabilizer } from '../core/stabilizer';
import type { Condition, Printing } from '../core/types';
import type { Catalogs } from './App';
import { drawCard, grabCard, OCR_CROP_HEIGHT, startCamera, stopCamera } from './camera';
import { detectLanguage } from '../core/language';
import { cropTextRegion, readText, warmUpOcr } from './ocr';
import type { Prefs } from './prefs';
import type { Recognizer } from './recognizer';
import { printingLabel } from './format';
import { imageIn, nameIn } from '../core/catalog';

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

const thumb = (p: Printing, lang: string) => {
  const img = imageIn(p, lang);
  return img.thumbUrl ?? img.imageUrl;
};

interface Saved {
  result: AddResult;
  printing: Printing;
  input: ScanInput;
  sample?: Sample;
  /** „Falsch erkannt“ wurde gedrückt, der Scan liegt jetzt unter „Prüfen“. */
  flagged?: boolean;
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
  const [readingLanguage, setReadingLanguage] = useState(false);
  const ocrCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Zuletzt erkannte Sprache; Fallback, wenn der Text nicht eindeutig ist (Stapel sind meist einsprachig). */
  const lastLanguage = useRef<string | null>(null);

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
        const { matches, ms, vector } = await recognizer.match(gameId, pixels);
        if (!active) break;
        const printings = catalogs.ordered.get(gameId) ?? [];
        const top = matches[0];
        setGuess(top ? { printing: printings[top.index], score: top.score, ms } : null);
        const stable = stabilizer.current.push(matches);
        if (stable) {
          const p = prefsRef.current;
          const printing = printings[stable.index];
          const languages = catalogs.languages.get(gameId)?.map((l) => l.code) ?? ['en'];
          let language = p.language;
          if (language === 'auto' || !languages.includes(language)) {
            const ctx = drawCard(videoRef.current!, ocrCanvasRef.current!, OCR_CROP_HEIGHT);
            setReadingLanguage(true);
            const region = ctx ? cropTextRegion(ocrCanvasRef.current!, document.createElement('canvas')) : null;
            const guess = region
              ? await detectLanguage((script) => readText(region, script), printing.texts ?? {}, languages)
              : { lang: null };
            setReadingLanguage(false);
            if (!active) break;
            language = guess.lang ?? lastLanguage.current ?? languages[0];
            if (guess.lang) lastLanguage.current = guess.lang;
          }
          const input: ScanInput = {
            gameId,
            printingId: printing.printingId,
            language,
            finish: p.finish,
            condition: p.condition,
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
          setRecent((r) => [{ result, printing, input, sample }, ...r].slice(0, 5));
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

  /** Sicher gespeichert, aber falsch: Scan als unsicher unter „Prüfen“ ablegen, dort die richtige Karte wählen. */
  const flag = async (saved: Saved) => {
    await service.undo(saved.result);
    const result = await service.addScan({ ...saved.input, confirmed: false });
    if (saved.sample) await learning.reassign(saved.sample, result.item.itemId);
    setRecent((r) => r.map((s) => (s === saved ? { ...s, result, input: { ...s.input, confirmed: false }, sample: s.sample && { ...s.sample, itemId: result.item.itemId, source: 'pending' }, flagged: true } : s)));
    onChange();
    if (saved.sample?.source === 'auto') onLearn();
  };

  const guide = box.w ? guideRect(box.w, box.h) : null;
  const ready = !status && recognizer && catalogs;

  return (
    <section class="scan">
      <div class="viewfinder">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} hidden />
        <canvas ref={ocrCanvasRef} hidden />
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
            {readingLanguage ? (
              <span>Lese Sprache …</span>
            ) : guess ? (
              <span>
                {nameIn(guess.printing, prefs.language === 'auto' ? lastLanguage.current ?? 'en' : prefs.language)} · {Math.round(guess.score * 100)} % · {guess.ms} ms
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
        <select value={prefs.condition} onChange={(e) => setPrefs({ condition: e.currentTarget.value as Condition })}>
          {['NM', 'LP', 'MP', 'HP', 'DMG'].map((c) => <option value={c}>{c}</option>)}
        </select>
        <input
          placeholder="Lagerort (z. B. Binder 1)"
          value={prefs.location}
          onChange={(e) => setPrefs({ location: e.currentTarget.value })}
        />
      </div>

      {recent.length > 0 && (
        <ul class="recent">
          {recent.map((s) => (
            <li key={s.result.item.itemId + s.result.item.quantity}>
              <img src={thumb(s.printing, s.result.item.language)} alt="" loading="lazy" />
              <span>
                {printingLabel(s.printing, s.result.item.language)}
                <small> · {catalogs?.languages.get(s.result.item.gameId)?.find((l) => l.code === s.result.item.language)?.label}</small>
                {!s.result.item.confirmed && <em> · prüfen</em>}
                <small> ×{s.result.item.quantity}</small>
              </span>
              {s.result.item.confirmed && !s.flagged && <button onClick={() => flag(s)}>Falsch</button>}
              <button onClick={() => undo(s)}>Rückgängig</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
