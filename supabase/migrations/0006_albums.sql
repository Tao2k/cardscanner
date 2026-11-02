-- ScannR: eigene Alben mit Lieblingskarten. Bestätigte Freunde können sie ansehen.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (nach 0002). Das Skript darf mehrfach laufen.

-- Ein Album je Zeile; cards = Karten als „gameId|printingId“ in der Reihenfolge, in der sie dazukamen.
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  cards text[] not null default '{}' check (coalesce(array_length(cards, 1), 0) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists albums_user on public.albums (user_id, created_at);

create or replace function public.albums_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists albums_touch on public.albums;
create trigger albums_touch before update on public.albums
  for each row execute function public.albums_touch();

-- Nur die eigenen Alben lesen und schreiben.
alter table public.albums enable row level security;

drop policy if exists "eigene Alben" on public.albums;
create policy "eigene Alben" on public.albums
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Alben eines bestätigten Freundes (Name und Karten).
drop function if exists public.friend_albums(uuid);
create function public.friend_albums(friend uuid)
returns table (id uuid, name text, cards text[], created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.cards, a.created_at, a.updated_at
  from albums a
  where a.user_id = friend and are_friends(auth.uid(), friend)
  order by a.created_at, a.name
$$;

revoke execute on function public.friend_albums(uuid) from public, anon;
grant execute on function public.friend_albums(uuid) to authenticated;
