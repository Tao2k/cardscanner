import { useState } from 'preact/hooks';
import { cloud, cloudConfigured, useCloud, type CloudState } from './cloud';

/** Zeile in der Sammlung: Stand der Online-Sicherung, öffnet das Konto. */
export function CloudLine() {
  const state = useCloud();
  const [open, setOpen] = useState(false);
  if (!cloudConfigured) return null;
  return (
    <>
      <button class={`cloud-line ${state.status}`} onClick={() => setOpen(true)}>
        {cloudIcon}
        <span>{lineText(state)}</span>
      </button>
      {open && <AccountSheet state={state} onClose={() => setOpen(false)} />}
    </>
  );
}

function lineText(s: CloudState): string {
  switch (s.status) {
    case 'signed-out':
    case 'code-sent':
      return 'Sammlung online sichern';
    case 'choice':
      return 'Anmeldung abschließen';
    case 'syncing':
      return 'Wird abgeglichen …';
    case 'offline':
      return s.pending ? `Offline · ${s.pending} ${s.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : 'Offline';
    case 'error':
      return 'Abgleich fehlgeschlagen';
    default:
      return s.lastSync ? `Gesichert · ${when(s.lastSync)}` : 'Gesichert';
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `heute ${time}` : `${d.toLocaleDateString('de-DE')} ${time}`;
}

function AccountSheet({ state, onClose }: { state: CloudState; onClose(): void }) {
  const [email, setEmail] = useState(state.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = (fn: () => Promise<void>) => async (e?: Event) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (state.status === 'signed-out') {
    body = (
      <form class="account" onSubmit={act(() => cloud.sendCode(email.trim()))}>
        <h2>Sammlung online sichern</h2>
        <p class="muted">
          Mit einem Konto wird deine Sammlung zusätzlich auf dem Server gesichert und auf allen deinen Geräten abgeglichen. Ohne Anmeldung bleibt alles nur auf
          diesem Gerät.
        </p>
        <label class="field">
          <span>E-Mail</span>
          <input type="email" autocomplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="name@beispiel.de" />
        </label>
        <button class="primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Sende …' : 'Code per E-Mail senden'}
        </button>
      </form>
    );
  } else if (state.status === 'code-sent') {
    body = (
      <form class="account" onSubmit={act(() => cloud.verifyCode(state.email ?? email, code))}>
        <h2>Code eingeben</h2>
        <p class="muted">Wir haben dir einen Code an {state.email} geschickt. Er gilt eine Stunde.</p>
        <label class="field">
          <span>Code</span>
          <input
            inputMode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9 ]{6,10}"
            required
            value={code}
            onInput={(e) => setCode(e.currentTarget.value)}
            placeholder="123456"
          />
        </label>
        <button class="primary" type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}>
          {busy ? 'Prüfe …' : 'Anmelden'}
        </button>
        <p class="muted">
          Keine E-Mail bekommen?
          <button type="button" class="link" onClick={() => cloud.restart()}>
            Andere Adresse oder neu senden
          </button>
        </p>
      </form>
    );
  } else if (state.status === 'choice') {
    body = (
      <div class="account">
        <h2>Auf dem Server liegt schon eine Sammlung</h2>
        <p class="muted">
          Dein Konto hat dort {state.remoteCount ?? 'bereits'} Einträge, und auf diesem Gerät sind auch Karten. Zusammenführen lädt die Karten dieses Geräts
          dazu (gleiche Karten zählen dann doppelt). Server-Stand übernehmen ersetzt die Karten auf diesem Gerät.
        </p>
        <button class="primary" disabled={busy} onClick={act(() => cloud.choose('merge'))}>
          Zusammenführen
        </button>
        <button disabled={busy} onClick={act(() => cloud.choose('server'))}>
          Server-Stand übernehmen
        </button>
      </div>
    );
  } else {
    body = (
      <div class="account">
        <h2>Konto</h2>
        <p>{state.email}</p>
        <p class="muted">
          {lineText(state)}
          {state.pending > 0 && state.status !== 'offline' ? ` · ${state.pending} ${state.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : ''}
        </p>
        {state.status === 'error' && state.message && <p class="banner error">{state.message}</p>}
        <button class="primary" disabled={busy || state.status === 'syncing'} onClick={act(() => cloud.syncNow())}>
          Jetzt abgleichen
        </button>
        <button disabled={busy} onClick={act(() => cloud.signOut())}>
          Abmelden
        </button>
        <p class="muted">Beim Abmelden bleiben die Karten auf diesem Gerät.</p>
      </div>
    );
  }

  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="sheet account-sheet" role="dialog" aria-label="Konto">
        <div class="grabber" />
        {body}
        {error && <p class="banner error">{error}</p>}
        <button class="link close" onClick={onClose}>
          Schließen
        </button>
      </div>
    </>
  );
}

const cloudIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
  </svg>
);
