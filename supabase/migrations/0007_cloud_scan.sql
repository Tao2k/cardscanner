-- ScannR: Tageslimit für die Cloud-Hilfe bei unsicheren Scans (Funktion identify-card).
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen. Das Skript darf mehrfach laufen.

-- Anfragen je Person und Tag. Niemand liest oder schreibt die Tabelle direkt, nur über use_cloud_scan.
create table if not exists public.cloud_scan_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

alter table public.cloud_scan_usage enable row level security;

-- Zählt eine Anfrage und sagt, ob sie heute noch erlaubt ist (höchstens max_per_day je Person).
create or replace function public.use_cloud_scan(max_per_day int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  used int;
begin
  if auth.uid() is null then
    return false;
  end if;
  insert into cloud_scan_usage (user_id, day, count) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = cloud_scan_usage.count + 1
  returning count into used;
  return used <= max_per_day;
end $$;

revoke all on function public.use_cloud_scan(int) from public, anon;
grant execute on function public.use_cloud_scan(int) to authenticated;
