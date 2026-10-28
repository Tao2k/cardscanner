-- ScannR: Sammlung auf dem Server (Schritt 1: Anmeldung, Sicherung, Abgleich zwischen Geräten).
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen. Das Skript darf mehrfach laufen.

-- Profil je Konto. Freunde und Sichtbarkeit kommen in Schritt 2 dazu.
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- Ein Eintrag der Sammlung, wie in der App (CollectionItem). Gelöschte Einträge bleiben als
-- „deleted“ stehen, damit andere Geräte das Löschen mitbekommen.
create table if not exists public.collection_items (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id text not null,
  game_id text,
  printing_id text,
  language text,
  quantity integer,
  condition text,
  finish text,
  location text,
  notes text,
  confirmed boolean,
  -- Erkennungsdetails (matchScore, alternatives), nur für die eigene Prüfliste
  extra jsonb not null default '{}',
  -- Zeitstempel der App, unverändert als Text, damit sie auf allen Geräten gleich aussehen
  added_at text,
  updated_at text,
  deleted boolean not null default false,
  -- Wann die Änderung auf dem Gerät passiert ist: die neueste gewinnt
  changed_at timestamptz not null,
  -- Wann der Server die Zeile geschrieben hat: Geräte holen alles seit ihrem letzten Abgleich
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, item_id)
);

create index if not exists collection_items_sync on public.collection_items (user_id, server_updated_at);
create index if not exists collection_items_printing on public.collection_items (game_id, printing_id) where not deleted;

-- Ältere Änderungen (z. B. von einem Gerät, das lange offline war) überschreiben keine neueren.
create or replace function public.collection_items_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.changed_at < old.changed_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists collection_items_touch on public.collection_items;
create trigger collection_items_touch before insert or update on public.collection_items
  for each row execute function public.collection_items_touch();

-- Nur die eigene Sammlung lesen und schreiben.
alter table public.profiles enable row level security;
alter table public.collection_items enable row level security;

drop policy if exists "eigenes Profil" on public.profiles;
create policy "eigenes Profil" on public.profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "eigene Sammlung" on public.collection_items;
create policy "eigene Sammlung" on public.collection_items
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Kleiner Aufruf für den wöchentlichen Wach-Lauf (GitHub Actions), damit das Gratis-Projekt nicht pausiert.
create or replace function public.ping() returns integer
language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;
