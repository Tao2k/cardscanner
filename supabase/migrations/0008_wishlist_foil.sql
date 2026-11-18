-- ScannR: Wunschliste mit Foil-Wunsch. Die Anzahl je Wunsch (quantity) gibt es schon seit 0004.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (nach 0004 und 0005). Das Skript darf mehrfach laufen.
-- Ohne dieses Skript geht die Wunschliste weiter; nur „Foil“ lässt sich dann nicht speichern.

alter table public.wishlist add column if not exists foil boolean not null default false;

-- Freunde sehen auch, ob die Karte Foil sein soll (neue Spalte, daher neu anlegen)
drop function if exists public.friend_wishlist(uuid);
create function public.friend_wishlist(friend uuid)
returns table (game_id text, printing_id text, quantity integer, foil boolean)
language sql stable security definer set search_path = public as $$
  select w.game_id, w.printing_id, w.quantity, w.foil
  from wishlist w
  where w.user_id = friend and are_friends(auth.uid(), friend)
  order by w.game_id, w.printing_id
$$;

revoke execute on function public.friend_wishlist(uuid) from public, anon;
grant execute on function public.friend_wishlist(uuid) to authenticated;

-- Die App liest die neue Spalte sofort
notify pgrst, 'reload schema';
