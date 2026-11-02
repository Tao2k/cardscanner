-- ScannR: Wunschliste im Tab „Tausch“. Freunde sehen sie, damit sie wissen, was man sucht.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (nach 0002). Das Skript darf mehrfach laufen.

-- Eine Zeile je gewünschtem Druck. quantity = wie viele Exemplare man sucht (die App setzt bisher 1).
create table if not exists public.wishlist (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  game_id text not null,
  printing_id text not null,
  quantity integer not null default 1 check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  primary key (user_id, game_id, printing_id)
);

-- Nur die eigene Wunschliste lesen und schreiben.
alter table public.wishlist enable row level security;

drop policy if exists "eigene Wunschliste" on public.wishlist;
create policy "eigene Wunschliste" on public.wishlist
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Wunschliste eines bestätigten Freundes (nur Karte und Anzahl).
drop function if exists public.friend_wishlist(uuid);
create function public.friend_wishlist(friend uuid)
returns table (game_id text, printing_id text, quantity integer)
language sql stable security definer set search_path = public as $$
  select w.game_id, w.printing_id, w.quantity
  from wishlist w
  where w.user_id = friend and are_friends(auth.uid(), friend)
  order by w.game_id, w.printing_id
$$;

revoke execute on function public.friend_wishlist(uuid) from public, anon;
grant execute on function public.friend_wishlist(uuid) to authenticated;
