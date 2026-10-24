/**
 * Wann die App nach einer neuen Version sucht und wann sie neu lädt.
 *
 * Auf dem iPhone wird eine Home-Bildschirm-App beim Zurückkehren nur aufgeweckt, nicht neu
 * geöffnet; der Browser sucht dann von sich aus nicht nach Updates. Darum sucht die App selbst:
 * beim Start, beim Zurückkehren und regelmäßig, aber nie mitten im Scan. Neu geladen wird nur in
 * einem ruhigen Moment. Die Sammlung liegt in IndexedDB und übersteht jedes Neuladen.
 */
export interface UpdateDeps {
  /** Fragt beim Server nach einer neuen Version; true, wenn eine gefunden wurde. */
  check(): Promise<boolean>;
  /** Lädt die Seite neu (die neue Version ist dann schon aktiv). */
  reload(): void;
  now(): number;
}

export interface UpdateOptions {
  /** Höchstens so oft beim Server nachfragen (außer von Hand). */
  minIntervalMs: number;
}

export const DEFAULT_UPDATE: UpdateOptions = { minIntervalMs: 60_000 };

export class UpdateScheduler {
  private busy = false;
  private visible = true;
  private lastCheck = -Infinity;
  /** Eine Suche fiel aus, weil gerade gescannt wurde; wird danach nachgeholt. */
  private checkSkipped = false;
  /** Neue Version ist aktiv, die Seite zeigt aber noch die alte. */
  pending = false;
  /** Meldet, ob der Hinweis „Neue Version verfügbar“ zu sehen sein soll. */
  onPendingChange?: (pending: boolean) => void;

  constructor(
    private deps: UpdateDeps,
    private opts: UpdateOptions = DEFAULT_UPDATE,
  ) {}

  /** Scan läuft, Nachfrage oder Korrektur offen: dann weder suchen noch neu laden. */
  setBusy(busy: boolean) {
    if (this.busy === busy) return;
    this.busy = busy;
    if (!busy && this.checkSkipped && !this.pending) void this.maybeCheck();
  }

  /** App geht in den Hintergrund oder kommt zurück. */
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (this.pending && !this.busy) {
      // Unsichtbar oder gerade erst zurück: Neuladen fällt nicht auf.
      this.deps.reload();
      return;
    }
    if (visible) void this.maybeCheck();
  }

  /** Sucht nach einer neuen Version, wenn es gerade passt; `manual` = Knopf in den Einstellungen. */
  async maybeCheck(manual = false): Promise<boolean> {
    if (this.pending) return true;
    if (this.busy && !manual) {
      this.checkSkipped = true;
      return false;
    }
    if (!manual && (!this.visible || this.deps.now() - this.lastCheck < this.opts.minIntervalMs)) return false;
    this.lastCheck = this.deps.now();
    this.checkSkipped = false;
    try {
      return await this.deps.check();
    } catch {
      // Offline oder Server nicht erreichbar: beim nächsten Mal wieder versuchen
      return false;
    }
  }

  /** Die neue Version ist aktiv geworden. */
  activated() {
    if (!this.busy) {
      this.deps.reload();
      return;
    }
    this.pending = true;
    this.onPendingChange?.(true);
  }

  /** Knopf „Neu laden“ im Hinweis. */
  applyNow() {
    this.deps.reload();
  }
}
