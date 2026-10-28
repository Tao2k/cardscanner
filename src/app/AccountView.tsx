import { useState } from 'preact/hooks';
import { cloud, cloudConfigured, useCloud, type CloudState } from './cloud';

/** Mit Supabase-Projekt ist die Anmeldung Pflicht: bis dahin zeigt die App nur diese Seite. */
export function needsLogin(state: CloudState): boolean {
  return cloudConfigured && (state.status === 'loading' || !state.signedIn || !!state.recovery);
}

/** Anmeldeseite beim Start (E-Mail und Passwort). */
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

type LoginMode = 'login' | 'signup' | 'reset';

/** Anmelden, Konto erstellen, Passwort vergessen; nach dem Link aus der E-Mail ein neues Passwort setzen. */
function LoginForm({ state }: { state: CloudState }) {
  const [mode, setMode] = useState<LoginMode>('login');
  const [email, setEmail] = useState(state.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const submit = (fn: () => Promise<void>) => async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const switchTo = (next: LoginMode) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  const brand = (
    <header class="login-brand">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={64} height={64} />
      <h1>
        Scann<b>R</b>
      </h1>
    </header>
  );
  const emailField = (
    <label class="field">
      <span>E-Mail</span>
      <input type="email" autocomplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="name@beispiel.de" />
    </label>
  );
  const passwordField = (autocomplete: string) => (
    <label class="field">
      <span>Passwort</span>
      <input type="password" autocomplete={autocomplete} required minLength={6} value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
    </label>
  );
  const messages = (
    <>
      {error && <p class="banner error">{error}</p>}
      {info && <p class="banner">{info}</p>}
    </>
  );

  if (state.recovery) {
    return (
      <form class="account" onSubmit={submit(() => cloud.setNewPassword(password))}>
        {brand}
        <h2>Neues Passwort</h2>
        {passwordField('new-password')}
        <button class="primary" type="submit" disabled={busy || password.length < 6}>
          Speichern
        </button>
        {messages}
      </form>
    );
  }
  if (mode === 'reset') {
    return (
      <form class="account" onSubmit={submit(async () => (await cloud.resetPassword(email.trim()), setInfo('Link gesendet. Bitte E-Mail öffnen.')))}>
        {brand}
        <h2>Passwort vergessen</h2>
        {emailField}
        <button class="primary" type="submit" disabled={busy || !email.trim()}>
          Link senden
        </button>
        {messages}
        <button type="button" class="link" onClick={() => switchTo('login')}>
          Zurück zur Anmeldung
        </button>
      </form>
    );
  }
  const signup = mode === 'signup';
  return (
    <form class="account" onSubmit={submit(() => (signup ? cloud.signUp(email.trim(), password) : cloud.signIn(email.trim(), password)))}>
      {brand}
      <h2>{signup ? 'Konto erstellen' : 'Anmelden'}</h2>
      {emailField}
      {passwordField(signup ? 'new-password' : 'current-password')}
      <button class="primary" type="submit" disabled={busy || !email.trim() || password.length < 6}>
        {busy ? '…' : signup ? 'Konto erstellen' : 'Anmelden'}
      </button>
      {messages}
      <p class="muted login-switch">
        {signup ? 'Schon ein Konto?' : 'Neu hier?'}
        <button type="button" class="link" onClick={() => switchTo(signup ? 'login' : 'signup')}>
          {signup ? 'Anmelden' : 'Konto erstellen'}
        </button>
      </p>
      {!signup && (
        <button type="button" class="link forgot" onClick={() => switchTo('reset')}>
          Passwort vergessen?
        </button>
      )}
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
