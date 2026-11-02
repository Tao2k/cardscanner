import { useEffect, useMemo, useState } from 'preact/hooks';
import { useBack } from './back';
import { KEEP, tradeBetween, type FriendCard, type Trade, type TradeCard } from '../core/friends';
import { formatEur, priceFor } from '../core/prices';
import type { CollectionItem, Printing } from '../core/types';
import { wishKey, wishOwners, type Wish, type WishAlert, type WishOwner } from '../core/wishlist';
import { FriendsApi, friendError, type Friend, type Profile } from '../storage/friends';
import type { Catalogs } from './App';
import { albumBinder, buildBinders } from './binder';
import { albums } from './albums';
import type { Album } from '../core/albums';
import { BinderView, heart } from './BinderView';
import { cloud } from './cloud';
import { printingCode } from './format';
import { WishAlarmSheet } from './WishAlarmSheet';
import { useWishAlarm, useWishlist, wishlist, wishPrice, type WishAlarmState, type WishlistState } from './wishlist';

interface Props {
  items: CollectionItem[];
  catalogs: Catalogs;
  /** Freundescode aus einem Einladungslink (?freund=CODE). */
  invite: string | null;
  onInviteUsed(): void;
}

const INVITE_PARAM = 'freund';
/** So viele Treffer zeigt die Suche in der Wunschliste höchstens. */
const MAX_RESULTS = 30;

/** Freundescode aus der Adresse lesen (Einladungslink) und aus der Adresse entfernen. */
export function takeInvite(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get(INVITE_PARAM);
  if (!code) return null;
  url.searchParams.delete(INVITE_PARAM);
  history.replaceState(null, '', url);
  return code.toUpperCase();
}

/** Tab „Community“: Freunde mit ihren Bindern und Tauschvorschlägen. */
export function CommunityView({ items, catalogs, invite, onInviteUsed }: Props) {
  const [api, setApi] = useState<FriendsApi | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [collections, setCollections] = useState<Map<string, FriendCard[]>>(new Map());
  const [friendWishes, setFriendWishes] = useState<Map<string, Wish[]>>(new Map());
  const [code, setCode] = useState(invite ?? '');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const wish = useWishlist();

  const load = async (client: FriendsApi) => {
    const [me, list] = await Promise.all([client.profile(), client.list()]);
    setProfile(me);
    setFriends(list);
    const accepted = list.filter((f) => f.status === 'accepted');
    const [loaded, wishes] = await Promise.all([
      Promise.all(accepted.map(async (f) => [f.userId, await client.collection(f.userId)] as const)),
      // Ohne Wunschliste auf dem Server (0004 fehlt) bleiben die Wünsche der Freunde leer
      Promise.all(accepted.map(async (f) => [f.userId, await wishlist.ofFriend(f.userId).catch(() => [])] as const)),
    ]);
    setCollections(new Map(loaded));
    setFriendWishes(new Map(wishes));
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
    // Wünsche können auf einem anderen Gerät dazugekommen sein
    wishlist.load(true);
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

  const trades = useMemo(
    () =>
      new Map(
        [...collections].map(([id, cards]) => [id, tradeBetween(items, cards, KEEP, { mine: wish.keys, friend: (friendWishes.get(id) ?? []).map(wishKey) })]),
      ),
    [items, collections, wish.keys, friendWishes],
  );
  const owners = useMemo(() => wishOwners(wish.wishes, collections, KEEP), [wish.wishes, collections]);
  /** Wie viele eigene Wünsche ein Freund hat. */
  const wishesAt = useMemo(() => {
    const counts = new Map<string, number>();
    for (const list of owners.values()) for (const o of list) counts.set(o.userId, (counts.get(o.userId) ?? 0) + 1);
    return counts;
  }, [owners]);

  const friend = selected ? friends.find((f) => f.userId === selected) : undefined;
  if (friend) {
    return (
      <FriendDetail
        friend={friend}
        cards={collections.get(friend.userId) ?? []}
        trade={trades.get(friend.userId) ?? { get: [], give: [] }}
        wishes={friendWishes.get(friend.userId) ?? []}
        items={items}
        catalogs={catalogs}
        wish={wish}
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
        <h1>Community</h1>
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
            const wished = wishesAt.get(f.userId) ?? 0;
            return (
              <li key={f.userId}>
                <button class="friend-row" onClick={() => setSelected(f.userId)}>
                  <span class="friend-name">{f.displayName || 'Unbekannt'}</span>
                  {t && (
                    <small class="muted">
                      Bekommen {count(t.get)} · Abgeben {count(t.give)}
                      {wished > 0 && ' · '}
                      {wished > 0 && (
                        <span class="wish-count">
                          {heart} {wished} {wished === 1 ? 'Wunsch' : 'Wünsche'}
                        </span>
                      )}
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

/**
 * Wunschliste im Tab „Sammlung“. Lädt die Sammlungen der Freunde nur, um zu zeigen, wer eine gewünschte Karte übrig hat;
 * ohne Freunde oder Verbindung bleibt das einfach leer.
 */
export function WishlistView({ items, catalogs, gameId }: { items: CollectionItem[]; catalogs: Catalogs; gameId: string }) {
  const wish = useWishlist();
  const alarm = useWishAlarm(wish, catalogs);
  const [collections, setCollections] = useState<Map<string, FriendCard[]>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    // Wünsche können auf einem anderen Gerät dazugekommen sein
    wishlist.load(true);
    (async () => {
      try {
        const client = new FriendsApi(await cloud.getClient());
        const accepted = (await client.list()).filter((f) => f.status === 'accepted');
        setNames(new Map(accepted.map((f) => [f.userId, f.displayName || 'Unbekannt'])));
        setCollections(new Map(await Promise.all(accepted.map(async (f) => [f.userId, await client.collection(f.userId)] as const))));
      } catch {
        /* ohne Freunde keine Hinweise, wer die Karte hat */
      }
    })();
  }, []);

  const owners = useMemo(() => wishOwners(wish.wishes, collections, KEEP), [wish.wishes, collections]);
  return (
    <section class="wishes">
      <WishlistSection catalogs={catalogs} items={items} gameId={gameId} wish={wish} alarm={alarm} owners={owners} names={names} />
    </section>
  );
}

const count = (cards: TradeCard[]) => cards.reduce((n, c) => n + c.spare, 0);

/** Herz-Knopf: Karte auf die Wunschliste setzen oder wieder herunternehmen. */
export function WishToggle({ gameId, printingId, wish, compact }: { gameId: string; printingId: string; wish: WishlistState; compact?: boolean }) {
  if (wish.status === 'idle' || wish.status === 'unavailable') return null;
  const on = wish.keys.has(wishKey({ gameId, printingId }));
  const label = on ? 'Von der Wunschliste nehmen' : 'Auf die Wunschliste';
  return (
    <button
      class={`wish-toggle${on ? ' on' : ''}${compact ? ' icon' : ''}`}
      aria-pressed={on}
      aria-label={compact ? label : undefined}
      onClick={() => wishlist.toggle(gameId, printingId)}
    >
      {on ? heart : heartOutline}
      {!compact && (on ? 'Auf der Wunschliste' : 'Auf die Wunschliste')}
    </button>
  );
}

const heartOutline = (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.7 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linejoin="round"
    />
  </svg>
);

/** Glocke für den Preisalarm. */
const bell = (
  <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
    <path
      d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

/** Eigene Anzahl je Druck (über Sprache, Zustand und Ausführung). */
function ownedCounts(items: CollectionItem[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(wishKey(i), (counts.get(wishKey(i)) ?? 0) + i.quantity);
  return counts;
}

function WishlistSection({
  catalogs,
  items,
  gameId,
  wish,
  alarm,
  owners,
  names,
}: {
  catalogs: Catalogs;
  items: CollectionItem[];
  gameId: string;
  wish: WishlistState;
  alarm: WishAlarmState;
  owners: Map<string, WishOwner[]>;
  names: Map<string, string>;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  /** Preisalarme, die beim Öffnen neu waren; bleiben als „Neu“ markiert, solange die Liste offen ist. */
  const [fresh, setFresh] = useState<Map<string, WishAlert>>(new Map());
  const owned = useMemo(() => ownedCounts(items), [items]);
  const priceOf = (gameId: string, printing?: Printing) => (printing ? wishPrice(catalogs, gameId, printing.printingId) : undefined);

  useEffect(() => {
    if (!alarm.alerts.length) return;
    setFresh((old) => new Map([...old, ...alarm.alerts.map((a) => [a.key, a] as const)]));
    alarm.seen(alarm.alerts);
  }, [alarm.alerts]);

  // Suche über alle Drucke, das gewählte Spiel zuerst; Name, Set und Nummer („OGN 42“) zählen
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 2) return [];
    const games = [gameId, ...catalogs.games.map((g) => g.gameId).filter((g) => g !== gameId)];
    const hits: { gameId: string; printing: Printing }[] = [];
    for (const g of games) {
      for (const printing of catalogs.ordered.get(g) ?? []) {
        const text = `${printing.cardName} ${printing.setCode} ${printing.collectorNumber} ${printing.setCode}${printing.collectorNumber}`.toLowerCase();
        if (text.includes(q)) hits.push({ gameId: g, printing });
        if (hits.length >= MAX_RESULTS) return hits;
      }
    }
    return hits;
  }, [q, catalogs, gameId]);

  const value = wish.wishes.reduce((n, w) => n + (priceOf(w.gameId, catalogs.lookup(w.gameId, w.printingId)) ?? 0) * w.quantity, 0);
  const ownersText = (key: string) => {
    const list = owners.get(key) ?? [];
    if (!list.length) return null;
    return list.map((o) => `${names.get(o.userId) ?? 'Unbekannt'}${o.spare > 0 ? ` (${o.spare}× übrig)` : ''}`).join(', ');
  };

  if (wish.status === 'unavailable') {
    return (
      <div class="empty-state">
        <strong>Wunschliste noch nicht eingerichtet</strong>
        <p>Auf dem Server fehlt die Tabelle dafür.</p>
      </div>
    );
  }

  return (
    <>
      {wish.message && <p class="banner error">{wish.message}</p>}
      <input
        type="search"
        class="wish-search"
        enterkeyhint="search"
        placeholder="Karte suchen und hinzufügen"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      {q.length >= 2 && (
        <>
          {results.length ? (
            <ol class="items wish-results" aria-label="Treffer">
              {results.map(({ gameId: g, printing }) => {
                const price = priceOf(g, printing);
                const have = owned.get(wishKey({ gameId: g, printingId: printing.printingId })) ?? 0;
                return (
                  <li key={`${g}|${printing.printingId}`}>
                    <div class="main">
                      <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />
                      <span class="info">
                        <strong>{printing.cardName}</strong>
                        <small>
                          {printingCode(printing)}
                          {have > 0 ? ` · ${have}× bei dir` : ''}
                        </small>
                        {price !== undefined && <span class="price">{formatEur(price)}</span>}
                      </span>
                      <WishToggle gameId={g} printingId={printing.printingId} wish={wish} compact />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p class="muted none">Keine Karte</p>
          )}
          <hr class="wish-divider" />
        </>
      )}

      {wish.status === 'loading' && !wish.wishes.length && <p class="muted">Lade …</p>}
      {wish.wishes.length > 0 && (
        <p class="muted trade-sum">
          {wish.wishes.length} {wish.wishes.length === 1 ? 'Karte' : 'Karten'} · {formatEur(value)}
        </p>
      )}
      {wish.wishes.length > 0 && (
        <ol class="items wish-list" aria-label="Wunschliste">
          {wish.wishes.map((w) => {
            const printing = catalogs.lookup(w.gameId, w.printingId);
            const price = priceOf(w.gameId, printing);
            const key = wishKey(w);
            const at = ownersText(key);
            const have = owned.get(key) ?? 0;
            const news = fresh.get(key);
            const reached = w.target !== undefined && price !== undefined && price <= w.target;
            return (
              <li key={key} class={news ? 'alarm' : undefined}>
                <div class="main">
                  {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
                  <button class="info" aria-label={`${printing?.cardName ?? w.printingId}, Preisalarm einstellen`} onClick={() => setEditing(key)}>
                    <strong>{printing?.cardName ?? w.printingId}</strong>
                    <small>
                      {printing ? printingCode(printing) : ''}
                      {have > 0 ? ` · ${have}× bei dir` : ''}
                    </small>
                    <span class="line">
                      {price !== undefined && <span class="price">{formatEur(price)}</span>}
                      {reached ? (
                        <em class="tag up">{bell} Ziel erreicht</em>
                      ) : (
                        w.target !== undefined && <em class="tag alarm-target">{bell} {formatEur(w.target)}</em>
                      )}
                      {news?.kind === 'drop' && <em class="tag down">▼ {Math.round((1 - news.price / news.from) * 100)} %</em>}
                      {news && <em class="tag new">Neu</em>}
                      {at && <em class="tag up">{at}</em>}
                    </span>
                  </button>
                  <WishToggle gameId={w.gameId} printingId={w.printingId} wish={wish} compact />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {editing &&
        (() => {
          const w = wish.wishes.find((x) => wishKey(x) === editing);
          if (!w) return null;
          const printing = catalogs.lookup(w.gameId, w.printingId);
          return <WishAlarmSheet wish={w} printing={printing} price={priceOf(w.gameId, printing)} targets={wish.targets} onClose={() => setEditing(null)} />;
        })()}
      {wish.wishes.length > 0 && <p class="muted wish-hint">Tippe auf eine Karte für den Preisalarm.</p>}
      {wish.status === 'ready' && !wish.wishes.length && !q && (
        <div class="empty-state">
          <span class="empty-heart" aria-hidden="true">
            {heartOutline}
          </span>
          <strong>Noch keine Wünsche</strong>
        </div>
      )}
    </>
  );
}

type FriendTab = 'binder' | 'wishes' | 'get' | 'give';

function FriendDetail({
  friend,
  cards,
  trade,
  wishes,
  items,
  catalogs,
  wish,
  onBack,
  onRemove,
}: {
  friend: Friend;
  cards: FriendCard[];
  trade: Trade;
  /** Wunschliste des Freundes. */
  wishes: Wish[];
  items: CollectionItem[];
  catalogs: Catalogs;
  wish: WishlistState;
  onBack(): void;
  onRemove(): void;
}) {
  useBack(true, onBack);
  const [side, setSide] = useState<FriendTab>('binder');
  const name = friend.displayName || 'Unbekannt';
  const priceOf = (c: TradeCard) => priceFor(catalogs.price(c.gameId, c.printingId), c.finish, catalogs.lookup(c.gameId, c.printingId));
  // Wünsche zuerst, dann die teuersten
  const sorted = (list: TradeCard[]) => [...list].sort((a, b) => Number(!!b.wished) - Number(!!a.wished) || (priceOf(b) ?? -1) - (priceOf(a) ?? -1));
  const value = (list: TradeCard[]) => list.reduce((n, c) => n + (priceOf(c) ?? 0) * c.spare, 0);
  const owned = useMemo(() => ownedCounts(items), [items]);

  // Eigene Alben des Freundes (leer, solange 0006 auf dem Server fehlt)
  const [friendAlbums, setFriendAlbums] = useState<Album[]>([]);
  useEffect(() => {
    albums.ofFriend(friend.userId).then(setFriendAlbums, () => setFriendAlbums([]));
  }, [friend.userId]);

  // Binder wie in der eigenen Sammlung, aber nur Sets, aus denen der Freund etwas hat; dahinter seine Alben
  const binders = useMemo(() => {
    const gameId = cards[0]?.gameId ?? catalogs.games[0]?.gameId ?? '';
    return [
      ...buildBinders(cards.map((c) => c.gameId), catalogs.byGame, catalogs.sets, cards).filter((b) => b.owned > 0),
      ...friendAlbums.map((a) => albumBinder(a, catalogs.byGame, cards, gameId)).filter((b) => b.slots.length > 0),
    ];
  }, [cards, catalogs, friendAlbums]);
  const [binderKey, setBinderKey] = useState<string | null>(null);
  const binder = binders.find((b) => b.key === binderKey) ?? binders[0];

  return (
    <section class="friends">
      <header class="friend-head">
        <button class="link back" onClick={onBack}>
          ‹ Community
        </button>
        <h1>{name}</h1>
      </header>
      <div class="segmented" role="radiogroup" aria-label="Ansicht">
        <button role="radio" aria-checked={side === 'binder'} class={side === 'binder' ? 'active' : ''} onClick={() => setSide('binder')}>
          Binder
        </button>
        <button role="radio" aria-checked={side === 'wishes'} class={side === 'wishes' ? 'active' : ''} onClick={() => setSide('wishes')}>
          Wünsche
        </button>
        <button role="radio" aria-checked={side === 'get'} class={side === 'get' ? 'active' : ''} onClick={() => setSide('get')}>
          Bekommen ({count(trade.get)})
        </button>
        <button role="radio" aria-checked={side === 'give'} class={side === 'give' ? 'active' : ''} onClick={() => setSide('give')}>
          Abgeben ({count(trade.give)})
        </button>
      </div>

      {side === 'binder' &&
        (binder ? (
          <BinderView
            key={binder.gameId}
            binders={binders}
            catalogs={catalogs}
            selected={binder}
            onSelect={setBinderKey}
            arriving={[]}
            owner={name}
            wished={wish.keys}
            cardActions={(slot) => {
              const have = owned.get(slot.key) ?? 0;
              return (
                <div class="binder-card-actions">
                  <small class="muted">{have > 0 ? `Du hast ${have}×` : 'Fehlt dir'}</small>
                  <WishToggle gameId={binder.gameId} printingId={slot.printing.printingId} wish={wish} />
                </div>
              );
            }}
          />
        ) : (
          <div class="empty-state">
            <strong>Noch keine Karten</strong>
          </div>
        ))}

      {side === 'wishes' && <FriendWishes name={name} wishes={wishes} owned={owned} catalogs={catalogs} />}

      {(side === 'get' || side === 'give') && (
        <>
          <p class="muted trade-sum">
            {side === 'get' ? 'Hat übrig, fehlt dir oder steht auf deiner Wunschliste' : 'Hast du übrig, fehlt ihr/ihm oder steht auf ihrer/seiner Wunschliste'} ·{' '}
            {formatEur(value(trade[side]))}
          </p>
          {trade[side].length ? (
            <ol class="items">
              {sorted(trade[side]).map((c) => {
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
                          {c.wished && <em class="tag wish">{heart} Wunsch</em>}
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
        </>
      )}
      <button class="link remove-friend" onClick={onRemove}>
        Freund entfernen
      </button>
    </section>
  );
}

/** Wunschliste eines Freundes: was du davon hast, zuerst die Karten, die du abgeben kannst. */
function FriendWishes({ name, wishes, owned, catalogs }: { name: string; wishes: Wish[]; owned: Map<string, number>; catalogs: Catalogs }) {
  const rows = useMemo(() => {
    const list = wishes.map((w) => {
      const have = owned.get(wishKey(w)) ?? 0;
      return { wish: w, printing: catalogs.lookup(w.gameId, w.printingId), price: wishPrice(catalogs, w.gameId, w.printingId), have, spare: Math.max(0, have - KEEP) };
    });
    return list.sort((a, b) => Number(b.spare > 0) - Number(a.spare > 0) || (b.price ?? -1) - (a.price ?? -1));
  }, [wishes, owned, catalogs]);
  if (!rows.length) {
    return (
      <div class="empty-state">
        <strong>{name} hat noch keine Wünsche</strong>
      </div>
    );
  }
  const value = rows.reduce((n, r) => n + (r.price ?? 0) * r.wish.quantity, 0);
  const giveable = rows.filter((r) => r.spare > 0).length;
  return (
    <>
      <p class="muted trade-sum">
        {rows.length} {rows.length === 1 ? 'Karte' : 'Karten'} · {formatEur(value)}
        {giveable > 0 && ` · ${giveable} hast du übrig`}
      </p>
      <ol class="items wish-list" aria-label={`Wunschliste von ${name}`}>
        {rows.map(({ wish: w, printing, price, have, spare }) => (
          <li key={wishKey(w)}>
            <div class="main">
              {printing && <img src={printing.thumbUrl ?? printing.imageUrl} alt="" loading="lazy" />}
              <span class="info">
                <strong>{printing?.cardName ?? w.printingId}</strong>
                <small>{printing ? printingCode(printing) : ''}</small>
                <span class="line">
                  {price !== undefined && <span class="price">{formatEur(price)}</span>}
                  {spare > 0 ? <em class="tag up">{spare}× übrig bei dir</em> : have > 0 ? <em class="tag">{have}× bei dir</em> : null}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
