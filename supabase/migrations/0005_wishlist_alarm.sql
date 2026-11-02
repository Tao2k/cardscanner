-- ScannR: Preisalarm auf der Wunschliste. Je Wunsch ein optionaler Zielpreis in Euro.
-- Einmal im Supabase-Dashboard unter „SQL Editor“ ausführen (nach 0004). Das Skript darf mehrfach laufen.
-- Ohne dieses Skript geht die Wunschliste weiter; nur Zielpreise lassen sich dann nicht speichern.

alter table public.wishlist add column if not exists max_price numeric(10, 2);

alter table public.wishlist drop constraint if exists wishlist_max_price_check;
alter table public.wishlist add constraint wishlist_max_price_check check (max_price is null or max_price > 0);

-- Die App liest die neue Spalte sofort
notify pgrst, 'reload schema';
