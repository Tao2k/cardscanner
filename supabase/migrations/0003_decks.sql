-- ScannR: Decks auf dem Server, damit sie auf allen Geräten gleich sind.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (nach 0001). Das Skript darf mehrfach laufen.

-- Ein Deck wie in der App (src/core/deck.ts) als JSON. Gelöschte Decks bleiben als „deleted“ stehen,
-- damit andere Geräte das Löschen mitbekommen.
create table if not exists public.decks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  deck_id text not null,
  game_id text,
  data jsonb,
  deleted boolean not null default false,
  -- Wann die Änderung auf dem Gerät passiert ist: die neueste gewinnt
  changed_at timestamptz not null,
  -- Wann der Server die Zeile geschrieben hat: Geräte holen alles seit ihrem letzten Abgleich
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, deck_id)
);

create index if not exists decks_sync on public.decks (user_id, server_updated_at);

-- Ältere Änderungen (z. B. von einem Gerät, das lange offline war) überschreiben keine neueren.
create or replace function public.decks_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.changed_at < old.changed_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists decks_touch on public.decks;
create trigger decks_touch before insert or update on public.decks
  for each row execute function public.decks_touch();

-- Nur die eigenen Decks lesen und schreiben.
alter table public.decks enable row level security;

drop policy if exists "eigene Decks" on public.decks;
create policy "eigene Decks" on public.decks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
