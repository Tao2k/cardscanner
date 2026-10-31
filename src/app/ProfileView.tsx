import { useEffect, useState } from 'preact/hooks';
import { formatAsOf } from '../core/prices';
import type { CollectionItem } from '../core/types';
import { FriendsApi, friendError } from '../storage/friends';
import type { Catalogs } from './App';
import { lineText } from './AccountView';
import { cloud, cloudConfigured, useCloud, type CloudState } from './cloud';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs | null;
}

/** Profil: Anzeigename, Anmeldedaten, Abgleich mit dem Server, Abmelden und die rechtlichen Hinweise. */
export function ProfileView({ items, catalogs }: Props) {
  const state = useCloud();
  const signedIn = cloudConfigured && state.signedIn;
  return (
    <section class="profile">
      <h1>Profil</h1>
      {signedIn && (
        <>
          <DisplayName />
          <Credentials state={state} />
          <SyncGroup state={state} />
          <SignOut />
        </>
      )}
      <LegalNotice items={items} catalogs={catalogs} />
    </section>
  );
}

/** Fehler und Ladezustand für eine Aktion im Profil. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>, toMessage: (e: unknown) => string = (e) => (e as Error).message) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(toMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** Name, unter dem Freunde dich sehen (Profil aus 0002_friends.sql). */
function DisplayName() {
  const [api, setApi] = useState<FriendsApi | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    run(async () => {
      const client = new FriendsApi(await cloud.getClient());
      const me = await client.profile();
      setApi(client);
      setSaved(me.displayName);
      setName(me.displayName);
    }, friendError);
  }, []);

  const trimmed = name.trim();
  const save = (e: Event) => {
    e.preventDefault();
    if (!api) return;
    run(async () => {
      const me = await api.profile(trimmed);
      setSaved(me.displayName);
      setName(me.displayName);
      setDone(true);
    }, friendError);
  };

  return (
    <form class="profile-group" onSubmit={save} aria-busy={saved === null && !error}>
      <label class="field">
        <span>Anzeigename</span>
        <input
          value={name}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setDone(false);
          }}
          placeholder="Dein Name für Freunde"
          maxLength={30}
          autocomplete="nickname"
          disabled={saved === null}
        />
      </label>
      <button class="primary" type="submit" disabled={busy || !api || !trimmed || trimmed === saved}>
        Speichern
      </button>
      {done && trimmed === saved && <p class="muted profile-note" role="status">Gespeichert</p>}
      {error && <p class="banner error">{error}</p>}
    </form>
  );
}

type Editing = 'email' | 'password' | null;

/** E-Mail und Passwort ansehen und ändern. */
function Credentials({ state }: { state: CloudState }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [info, setInfo] = useState('');
  const toggle = (what: Exclude<Editing, null>) => {
    setEditing((e) => (e === what ? null : what));
    setInfo('');
  };
  const finish = (message: string) => {
    setEditing(null);
    setInfo(message);
  };

  return (
    <div class="profile-group">
      <h2>Anmeldung</h2>
      <div class="profile-row">
        <div>
          <span class="profile-label">E-Mail</span>
          <span class="profile-value">{state.email}</span>
        </div>
        <button class="link" aria-expanded={editing === 'email'} onClick={() => toggle('email')}>
          {editing === 'email' ? 'Abbrechen' : 'Ändern'}
        </button>
      </div>
      {editing === 'email' && <EmailForm current={state.email ?? ''} onDone={finish} />}
      <div class="profile-row">
        <div>
          <span class="profile-label">Passwort</span>
          <span class="profile-value" aria-label="verborgen">••••••••</span>
        </div>
        <button class="link" aria-expanded={editing === 'password'} onClick={() => toggle('password')}>
          {editing === 'password' ? 'Abbrechen' : 'Ändern'}
        </button>
      </div>
      {editing === 'password' && <PasswordForm onDone={finish} />}
      {info && (
        <p class="banner" role="status">
          {info}
        </p>
      )}
    </div>
  );
}

function EmailForm({ current, onDone }: { current: string; onDone(message: string): void }) {
  const [email, setEmail] = useState('');
  const { busy, error, run } = useAction();
  const next = email.trim();
  const submit = async (e: Event) => {
    e.preventDefault();
    let waiting = false;
    const ok = await run(async () => {
      waiting = await cloud.changeEmail(next);
    });
    if (ok) onDone(waiting ? `Bestätigungslink an ${next} gesendet. Bis du ihn öffnest, gilt die bisherige Adresse.` : 'E-Mail geändert.');
  };
  return (
    <form class="profile-edit" onSubmit={submit}>
      <label class="field">
        <span>Neue E-Mail</span>
        <input type="email" autocomplete="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} placeholder="name@beispiel.de" />
      </label>
      <button class="primary" type="submit" disabled={busy || !next || next.toLowerCase() === current.toLowerCase()}>
        {busy ? '…' : 'E-Mail ändern'}
      </button>
      {error && <p class="banner error">{error}</p>}
    </form>
  );
}

function PasswordForm({ onDone }: { onDone(message: string): void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const { busy, error, setError, run } = useAction();
  const submit = async (e: Event) => {
    e.preventDefault();
    if (next !== repeat) return setError('Die neuen Passwörter sind nicht gleich.');
    if (await run(() => cloud.changePassword(current, next))) onDone('Passwort geändert.');
  };
  const field = (label: string, value: string, set: (v: string) => void, autocomplete: string) => (
    <label class="field">
      <span>{label}</span>
      <input type="password" autocomplete={autocomplete} required minLength={6} value={value} onInput={(e) => set(e.currentTarget.value)} />
    </label>
  );
  return (
    <form class="profile-edit" onSubmit={submit}>
      {field('Bisheriges Passwort', current, setCurrent, 'current-password')}
      {field('Neues Passwort', next, setNext, 'new-password')}
      {field('Neues Passwort wiederholen', repeat, setRepeat, 'new-password')}
      <button class="primary" type="submit" disabled={busy || !current || next.length < 6 || !repeat}>
        {busy ? '…' : 'Passwort ändern'}
      </button>
      {error && <p class="banner error">{error}</p>}
    </form>
  );
}

/** Stand des Abgleichs mit dem Server (früher im Wolken-Blatt der Sammlung). */
function SyncGroup({ state }: { state: CloudState }) {
  const { busy, error, run } = useAction();
  const waiting = state.pending > 0 && state.status !== 'offline' ? ` · ${state.pending} ${state.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : '';
  return (
    <div class="profile-group">
      <h2>Sammlung auf dem Server</h2>
      <p class="muted profile-note">
        {lineText(state)}
        {waiting}
      </p>
      {state.status === 'error' && state.message && <p class="banner error">{state.message}</p>}
      <button disabled={busy || state.status === 'syncing'} onClick={() => run(() => cloud.syncNow())}>
        Jetzt abgleichen
      </button>
      {error && <p class="banner error">{error}</p>}
    </div>
  );
}

function SignOut() {
  const { busy, error, run } = useAction();
  return (
    <div class="profile-group plain">
      <button class="danger-text" disabled={busy} onClick={() => run(() => cloud.signOut())}>
        {busy ? '…' : 'Abmelden'}
      </button>
      {error && <p class="banner error">{error}</p>}
    </div>
  );
}

/** Hinweise zu Riot Games, Kartendaten und Preisquellen. */
function LegalNotice({ items, catalogs }: Props) {
  const gameIds = items.length ? [...new Set(items.map((i) => i.gameId))] : (catalogs?.games.map((g) => g.gameId) ?? []);
  const priceSources = catalogs ? gameIds.map((g) => catalogs.prices.get(g)).filter((f) => !!f) : [];
  return (
    <footer class="legal profile-legal">
      <h2>Rechtliches</h2>
      <p>
        ScannR was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or
        sponsor this project.
      </p>
      <p>Kartendaten und Bilder: offizielle Riftbound-Kartengalerie.</p>
      {priceSources.map((f) => (
        <p>
          Preise: <a href={f.sourceUrl} target="_blank" rel="noopener">{f.source}</a>-Preisguide (Trendpreis, Near Mint), Stand {formatAsOf(f.asOf)}.
        </p>
      ))}
    </footer>
  );
}
