import { useEffect, useMemo, useState } from 'preact/hooks';
import { tradeBetween, type FriendCard, type Trade, type TradeCard } from '../core/friends';
import { formatEur, priceFor } from '../core/prices';
import type { CollectionItem } from '../core/types';
import { FriendsApi, friendError, type Friend, type Profile } from '../storage/friends';
import type { Catalogs } from './App';
import { cloud } from './cloud';
import { printingCode } from './format';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  /** Freundescode aus einem Einladungslink (?freund=CODE). */
  invite: string | null;
  onInviteUsed(): void;
}

const INVITE_PARAM = 'freund';

/** Freundescode aus der Adresse lesen (Einladungslink) und aus der Adresse entfernen. */
export function takeInvite(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get(INVITE_PARAM);
  if (!code) return null;
  url.searchParams.delete(INVITE_PARAM);
  history.replaceState(null, '', url);
  return code.toUpperCase();
}

export function FriendsView({ items, catalogs, invite, onInviteUsed }: Props) {
  const [api, setApi] = useState<FriendsApi | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [collections, setCollections] = useState<Map<string, FriendCard[]>>(new Map());
  const [code, setCode] = useState(invite ?? '');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async (client: FriendsApi) => {
    const [me, list] = await Promise.all([client.profile(), client.list()]);
    setProfile(me);
    setFriends(list);
    const accepted = list.filter((f) => f.status === 'accepted');
    const loaded = await Promise.all(accepted.map(async (f) => [f.userId, await client.collection(f.userId)] as const));
    setCollections(new Map(loaded));
  };

  useEffect(() => {
    (async () => {
      try {
        const client = new FriendsApi(await cloud.getClient());
        setApi(client);
        await load(client);
      } catch (e) {
        setError(friendError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const run = async (fn: (client: FriendsApi) => Promise<void>) => {
    if (!api) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await fn(api);
      await load(api);
    } catch (e) {
      setError(friendError(e));
    } finally {
      setBusy(false);
    }
  };

  const addFriend = (e: Event) => {
    e.preventDefault();
    run(async (client) => {
      const status = await client.add(code);
      setCode('');
      onInviteUsed();
      setInfo(status === 'accepted' ? 'Ihr seid jetzt befreundet.' : 'Anfrage gesendet.');
    });
  };

  const saveName = (e: Event) => {
    e.preventDefault();
    run(async (client) => {
      await client.profile(name);
      setName('');
    });
  };

  const share = async () => {
    if (!profile) return;
    const link = `${location.origin}${import.meta.env.BASE_URL}?${INVITE_PARAM}=${profile.friendCode}`;
    const text = `Mein ScannR-Code: ${profile.friendCode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ScannR', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setInfo('Link kopiert.');
      }
    } catch {
      /* Teilen abgebrochen */
    }
  };

  const trades = useMemo(() => new Map([...collections].map(([id, cards]) => [id, tradeBetween(items, cards)])), [items, collections]);

  const friend = selected ? friends.find((f) => f.userId === selected) : undefined;
  if (friend) {
    return (
      <FriendDetail
        friend={friend}
        trade={trades.get(friend.userId) ?? { get: [], give: [] }}
        catalogs={catalogs}
        onBack={() => setSelected(null)}
        onRemove={() => {
          if (!confirm(`${friend.displayName || 'Freund'} entfernen?`)) return;
          setSelected(null);
          run((client) => client.remove(friend.userId));
        }}
      />
    );
  }

  const incoming = friends.filter((f) => f.status === 'pending' && f.incoming);
  const outgoing = friends.filter((f) => f.status === 'pending' && !f.incoming);
  const accepted = friends.filter((f) => f.status === 'accepted');

  return (
    <section class="friends">
      <header>
        <h1>Freunde</h1>
      </header>
      {error && <p class="banner error">{error}</p>}
      {info && <p class="banner">{info}</p>}
      {loading && <p class="muted">Lade …</p>}

      {profile && (
        <div class="friend-code">
          <div>
            <small class="muted">Dein Code</small>
            <strong>{profile.friendCode}</strong>
          </div>
          <button class="primary" onClick={share}>
            Teilen
          </button>
        </div>
      )}

      {profile && !profile.displayName && (
        <form class="inline-form" onSubmit={saveName}>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Dein Name für Freunde" maxLength={30} required />
          <button type="submit" disabled={busy || !name.trim()}>
            Speichern
          </button>
        </form>
      )}

      <form class="inline-form" onSubmit={addFriend}>
        <input
          value={code}
          onInput={(e) => setCode(e.currentTarget.value.toUpperCase())}
          placeholder="Code eines Freundes"
          autocapitalize="characters"
          autocomplete="off"
          autocorrect="off"
          spellcheck={false}
          enterkeyhint="done"
          maxLength={6}
          required
        />
        <button type="submit" disabled={busy || code.trim().length < 6 || !api}>
          Hinzufügen
        </button>
      </form>

      {incoming.length > 0 && (
        <ul class="friend-list">
          {incoming.map((f) => (
            <li key={f.userId}>
              <span class="friend-name">{f.displayName || 'Unbekannt'}</span>
              <small class="muted">möchte befreundet sein</small>
              <span class="friend-actions">
                <button class="primary" disabled={busy} onClick={() => run((c) => c.accept(f.userId))}>
                  Annehmen
                </button>
                <button disabled={busy} onClick={() => run((c) => c.remove(f.userId))}>
                  Ablehnen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {accepted.length > 0 && (
        <ul class="friend-list">
          {accepted.map((f) => {
            const t = trades.get(f.userId);
            return (
              <li key={f.userId}>
                <button class="friend-row" onClick={() => setSelected(f.userId)}>
                  <span class="friend-name">{f.displayName || 'Unbekannt'}</span>
                  {t && (
                    <small class="muted">
                      Bekommen {count(t.get)} · Abgeben {count(t.give)}
                    </small>
                  )}
                  <svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {outgoing.length > 0 && (
        <ul class="friend-list">
          {outgoing.map((f) => (
            <li key={f.userId}>
              <span class="friend-name">{f.displayName || 'Unbekannt'}</span>
              <small class="muted">Anfrage gesendet</small>
              <span class="friend-actions">
                <button disabled={busy} onClick={() => run((c) => c.remove(f.userId))}>
                  Zurückziehen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && !friends.length && (
        <div class="empty-state">
          <strong>Noch keine Freunde</strong>
        </div>
      )}
    </section>
  );
}

const count = (cards: TradeCard[]) => cards.reduce((n, c) => n + c.spare, 0);

function FriendDetail({ friend, trade, catalogs, onBack, onRemove }: { friend: Friend; trade: Trade; catalogs: Catalogs; onBack(): void; onRemove(): void }) {
  const [side, setSide] = useState<'get' | 'give'>('get');
  const priceOf = (c: TradeCard) => priceFor(catalogs.price(c.gameId, c.printingId), c.finish, catalogs.lookup(c.gameId, c.printingId));
  const sorted = (cards: TradeCard[]) => [...cards].sort((a, b) => (priceOf(b) ?? -1) - (priceOf(a) ?? -1));
  const value = (cards: TradeCard[]) => cards.reduce((n, c) => n + (priceOf(c) ?? 0) * c.spare, 0);
  const cards = sorted(trade[side]);

  return (
    <section class="friends">
      <header class="friend-head">
        <button class="link back" onClick={onBack}>
          ‹ Freunde
        </button>
        <h1>{friend.displayName || 'Unbekannt'}</h1>
      </header>
      <div class="segmented" role="radiogroup" aria-label="Richtung">
        <button role="radio" aria-checked={side === 'get'} class={side === 'get' ? 'active' : ''} onClick={() => setSide('get')}>
          Bekommen ({count(trade.get)})
        </button>
        <button role="radio" aria-checked={side === 'give'} class={side === 'give' ? 'active' : ''} onClick={() => setSide('give')}>
          Abgeben ({count(trade.give)})
        </button>
      </div>
      <p class="muted trade-sum">
        {side === 'get' ? 'Hat übrig, fehlt dir' : 'Hast du übrig, fehlt ihr/ihm'} · {formatEur(value(trade[side]))}
      </p>
      {cards.length ? (
        <ol class="items">
          {cards.map((c) => {
            const printing = catalogs.lookup(c.gameId, c.printingId);
            const price = priceOf(c);
            return (
              <li key={`${c.gameId}|${c.printingId}`}>
                <div class="main">
                  {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
                  <span class="info">
                    <strong>{printing?.cardName ?? c.printingId}</strong>
                    <small>
                      {printing ? printingCode(printing) : ''}
                      {c.spare > 1 ? ` · ${c.spare}× übrig` : ''}
                    </small>
                    <span class="line">
                      {price !== undefined && <span class="price">{formatEur(price)}</span>}
                      {c.finish === 'foil' && <em class="tag foil">Foil</em>}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div class="empty-state">
          <strong>Keine Karten</strong>
        </div>
      )}
      <button class="link remove-friend" onClick={onRemove}>
        Freund entfernen
      </button>
    </section>
  );
}
