-- ScannR Schritt 2: Freunde per Code, gegenseitig bestätigt; Freunde sehen, welche Karten man hat.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (nach 0001). Das Skript darf mehrfach laufen.

-- Freundescode je Profil, z. B. „K7M2QX“ (ohne leicht verwechselbare Zeichen)
alter table public.profiles add column if not exists friend_code text unique;

create or replace function public.new_friend_code() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where friend_code = code);
  end loop;
  return code;
end $$;

-- Freundschaften: Anfrage von requester an addressee, gilt nach Bestätigung durch addressee
create table if not exists public.friendships (
  requester uuid not null references auth.users on delete cascade,
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

alter table public.friendships enable row level security;

drop policy if exists "eigene Freundschaften lesen" on public.friendships;
create policy "eigene Freundschaften lesen" on public.friendships
  for select to authenticated using (auth.uid() in (requester, addressee));

-- Beenden oder ablehnen dürfen beide Seiten; anlegen und bestätigen nur über die Funktionen unten
drop policy if exists "eigene Freundschaften beenden" on public.friendships;
create policy "eigene Freundschaften beenden" on public.friendships
  for delete to authenticated using (auth.uid() in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a))
  )
$$;

-- Eigenes Profil anlegen bzw. holen (mit Freundescode), Anzeigename optional setzen
create or replace function public.my_profile(name text default null)
returns table (display_name text, friend_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  insert into profiles (user_id, display_name, friend_code)
    values (auth.uid(), coalesce(nullif(trim(name), ''), ''), new_friend_code())
    on conflict (user_id) do update
      set display_name = coalesce(nullif(trim(name), ''), profiles.display_name),
          friend_code = coalesce(profiles.friend_code, new_friend_code());
  return query select p.display_name, p.friend_code from profiles p where p.user_id = auth.uid();
end $$;

-- Freund per Code hinzufügen. Hat die andere Person schon angefragt, gilt die Freundschaft sofort.
-- Ergebnis: 'pending' (Anfrage gesendet) oder 'accepted'
create or replace function public.add_friend(code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  select user_id into other from profiles where friend_code = upper(trim(code));
  if other is null then raise exception 'Code nicht gefunden'; end if;
  if other = auth.uid() then raise exception 'Das ist dein eigener Code'; end if;
  if exists (select 1 from friendships where requester = other and addressee = auth.uid()) then
    update friendships set status = 'accepted' where requester = other and addressee = auth.uid();
    return 'accepted';
  end if;
  if exists (select 1 from friendships where requester = auth.uid() and addressee = other) then
    return (select status from friendships where requester = auth.uid() and addressee = other);
  end if;
  insert into friendships (requester, addressee) values (auth.uid(), other);
  return 'pending';
end $$;

create or replace function public.accept_friend(other uuid) returns void
language sql security definer set search_path = public as $$
  update friendships set status = 'accepted' where requester = other and addressee = auth.uid();
$$;

-- Freunde und offene Anfragen mit Namen
create or replace function public.my_friends()
returns table (user_id uuid, display_name text, status text, incoming boolean)
language sql stable security definer set search_path = public as $$
  select case when f.requester = auth.uid() then f.addressee else f.requester end,
         coalesce(p.display_name, ''),
         f.status,
         f.addressee = auth.uid()
  from friendships f
  left join profiles p on p.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by f.status, p.display_name
$$;

-- Sammlung eines bestätigten Freundes: nur Karte, Ausführung und Anzahl je Druck
-- (keine Sprache, kein Zustand, kein Lagerort, keine Notizen)
drop function if exists public.friend_collection(uuid);
create function public.friend_collection(friend uuid)
returns table (game_id text, printing_id text, finish text, quantity integer)
language sql stable security definer set search_path = public as $$
  select c.game_id, c.printing_id, c.finish, sum(c.quantity)::integer
  from collection_items c
  where c.user_id = friend and not c.deleted and c.quantity > 0 and are_friends(auth.uid(), friend)
  group by c.game_id, c.printing_id, c.finish
  order by c.game_id, c.printing_id, c.finish
$$;

-- Funktionen sind sonst für alle aufrufbar (auch ohne Anmeldung)
revoke execute on function public.new_friend_code(), public.are_friends(uuid, uuid), public.my_profile(text),
  public.add_friend(text), public.accept_friend(uuid), public.my_friends(), public.friend_collection(uuid) from public, anon;
grant execute on function public.my_profile(text), public.add_friend(text), public.accept_friend(uuid),
  public.my_friends(), public.friend_collection(uuid) to authenticated;
