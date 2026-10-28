# Online-Sammlung mit Supabase

Die Sammlung liegt bei [Supabase](https://supabase.com); zum Benutzen der App meldet man sich an
(E-Mail und Passwort). Der Browser hält eine Kopie als Zwischenspeicher, damit Scannen und Ansehen auch
offline gehen; Änderungen warten dann in einer Warteschlange. Karten, die vor der ersten Anmeldung
auf dem Gerät lagen, werden dabei automatisch hochgeladen. Beim Abmelden werden die Karten vom Gerät
entfernt (erst wenn alles gesendet ist). Solange `project.json` leer ist, arbeitet die App wie
früher nur im Browser und fragt nicht nach einer Anmeldung.

## Einmal einrichten

1. Bei supabase.com ein Konto anlegen und ein Projekt erstellen: Region **Frankfurt (eu-central-1)**,
   Tarif **Free**.
2. **Tabellen anlegen:** im Dashboard *SQL Editor* öffnen, den Inhalt von
   [`migrations/0001_collection.sql`](migrations/0001_collection.sql) einfügen und ausführen, danach
   genauso [`migrations/0002_friends.sql`](migrations/0002_friends.sql) (Freunde). Die Skripte dürfen
   mehrfach laufen.
3. **Anmeldung mit Passwort:** *Authentication → Sign In / Providers → Email* öffnen und **Confirm email**
   ausschalten. Dann ist man nach „Konto erstellen“ sofort angemeldet. Supabase verschickt ohne
   eigenen E-Mail-Versand (SMTP) nur Links, und die öffnen sich auf dem iPhone in Safari statt in der
   installierten App. E-Mails gibt es nur noch für „Passwort vergessen“: Der Link öffnet die App im
   Browser, dort setzt man ein neues Passwort und meldet sich danach in der App damit an.
4. *Authentication → URL Configuration*: **Site URL** `https://tao2k.github.io/cardscanner/`.
5. *Project Settings → API*: **Project URL** und **anon public key** in `project.json` eintragen.
   Beide dürfen öffentlich sein; geschützt wird über die Regeln in der Datenbank (jede Person sieht
   nur ihre eigene Sammlung). Den **service_role key** nie eintragen oder weitergeben.

## Gut zu wissen

- **Kosten:** Der Free-Tarif kostet nichts (500 MB Datenbank, 50.000 aktive Nutzer im Monat). Eine
  Sammlung braucht weniger als 1 MB.
- **Pause:** Gratis-Projekte pausieren nach einer Woche ohne Zugriff. Der Workflow
  `.github/workflows/supabase-keepalive.yml` fragt deshalb zweimal pro Woche kurz an.
- **E-Mails:** Der eingebaute Versand von Supabase schickt nur wenige E-Mails pro Stunde. Das betrifft
  nur „Passwort vergessen“.
- **Freunde:** Jede Person hat einen Freundescode (6 Zeichen) und kann ihn als Link teilen
  (`…/cardscanner/?freund=CODE`). Eine Freundschaft gilt, wenn die andere Person annimmt oder
  ihrerseits den Code eingibt. Freunde sehen von der Sammlung nur Karte, Ausführung und Anzahl, keinen
  Lagerort und keine Notizen. „Übrig“ ist alles über ein Exemplar je Druck; vorgeschlagen werden nur
  Karten, die der anderen Seite ganz fehlen.
- **Abgleich:** Jede Änderung landet zuerst in einer Warteschlange im Browser und geht zum Server,
  sobald Netz da ist. Ändern zwei Geräte denselben Eintrag, gewinnt die spätere Änderung.
