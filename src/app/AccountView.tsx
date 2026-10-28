import { useState } from 'preact/hooks';
import { cloud, cloudConfigured, useCloud, type CloudState } from './cloud';

/** Mit Supabase-Projekt ist die Anmeldung Pflicht: bis dahin zeigt die App nur diese Seite. */
export function needsLogin(state: CloudState): boolean {
  return cloudConfigured && (state.status === 'loading' || !state.signedIn);
}

/** Anmeldeseite beim Start (E-Mail, dann Code). */
export function LoginScreen({ state }: { state: CloudState }) {
  if (state.status === 'loading') return <section class="login" aria-busy="true" />;
  return (
    <section class="login">
      <LoginForm state={state} />
      {state.status === 'error' && state.message && <p class="banner error">{state.message}</p>}
    </section>
  );
}

/** Zeile in der Sammlung: Stand des Abgleichs mit dem Server, öffnet das Konto. */
export function CloudLine() {
  const state = useCloud();
  const [open, setOpen] = useState(false);
  if (!cloudConfigured || !state.signedIn) return null;
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
    case 'syncing':
      return 'Wird abgeglichen …';
    case 'offline':
      return s.pending ? `Offline · ${s.pending} ${s.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : 'Offline';
    case 'error':
      return 'Abgleich fehlgeschlagen';
    default:
      return s.lastSync ? `Auf dem Server · ${when(s.lastSync)}` : 'Auf dem Server';
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `heute ${time}` : `${d.toLocaleDateString('de-DE')} ${time}`;
}

/** Erst E-Mail-Adresse, dann den Code aus der E-Mail. */
function LoginForm({ state }: { state: CloudState }) {
  const [email, setEmail] = useState(state.email ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = (fn: () => Promise<void>) => async (e: Event) => {
    e.preventDefault();
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

  const brand = (
    <header class="login-brand">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={64} height={64} />
      <h1>
        Scann<b>R</b>
      </h1>
    </header>
  );
  if (state.status === 'code-sent') {
    return (
      <form class="account" onSubmit={submit(() => cloud.verifyCode(state.email ?? email, code))}>
        {brand}
        <h2>Code eingeben</h2>
        <p class="muted">Gesendet an {state.email}</p>
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
        {error && <p class="banner error">{error}</p>}
        <p class="muted">
          Keine E-Mail bekommen?
          <button type="button" class="link" onClick={() => cloud.restart()}>
            Andere Adresse oder neu senden
          </button>
        </p>
      </form>
    );
  }
  return (
    <form class="account" onSubmit={submit(() => cloud.sendCode(email.trim()))}>
      {brand}
      <h2>Anmelden</h2>
      <label class="field">
        <span>E-Mail</span>
        <input type="email" autocomplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="name@beispiel.de" />
      </label>
      <button class="primary" type="submit" disabled={busy || !email.trim()}>
        {busy ? 'Sende …' : 'Code per E-Mail senden'}
      </button>
      {error && <p class="banner error">{error}</p>}
    </form>
  );
}

function AccountSheet({ state, onClose }: { state: CloudState; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = (fn: () => Promise<void>) => async () => {
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

  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="sheet account-sheet" role="dialog" aria-label="Konto">
        <div class="grabber" />
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
        </div>
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
