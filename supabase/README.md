# Online-Sammlung mit Supabase

Mit einem Konto wird die Sammlung zusätzlich bei [Supabase](https://supabase.com) gespeichert und
zwischen Geräten abgeglichen. Die App bleibt lokal zuerst: Scannen und die Sammlung funktionieren
offline und ohne Anmeldung. Solange `project.json` leer ist, zeigt die App kein Konto an.

## Einmal einrichten

1. Bei supabase.com ein Konto anlegen und ein Projekt erstellen: Region **Frankfurt (eu-central-1)**,
   Tarif **Free**.
2. **Tabellen anlegen:** im Dashboard *SQL Editor* öffnen, den Inhalt von
   [`migrations/0001_collection.sql`](migrations/0001_collection.sql) einfügen und ausführen.
3. **Code statt Link in der E-Mail:** *Authentication → Emails → Templates → Magic Link* öffnen und
   den Text ersetzen, z. B.:

   ```html
   <h2>Dein Code für ScannR</h2>
   <p>Gib diesen Code in der App ein: <strong>{{ .Token }}</strong></p>
   <p>Der Code gilt eine Stunde.</p>
   ```

   Warum: Eine als App installierte Seite (Startbildschirm) hat auf dem iPhone einen eigenen Speicher.
   Ein Link aus der E-Mail öffnet sich in Safari und würde dort anmelden, nicht in der App. Den Code
   tippt man direkt in der App ein.
4. *Authentication → URL Configuration*: **Site URL** `https://tao2k.github.io/cardscanner/`.
5. *Project Settings → API*: **Project URL** und **anon public key** in `project.json` eintragen.
   Beide dürfen öffentlich sein; geschützt wird über die Regeln in der Datenbank (jede Person sieht
   nur ihre eigene Sammlung). Den **service_role key** nie eintragen oder weitergeben.

## Gut zu wissen

- **Kosten:** Der Free-Tarif kostet nichts (500 MB Datenbank, 50.000 aktive Nutzer im Monat). Eine
  Sammlung braucht weniger als 1 MB.
- **Pause:** Gratis-Projekte pausieren nach einer Woche ohne Zugriff. Der Workflow
  `.github/workflows/supabase-keepalive.yml` fragt deshalb zweimal pro Woche kurz an.
- **E-Mails:** Der eingebaute E-Mail-Versand von Supabase schickt nur wenige E-Mails pro Stunde. Für
  einen Freundeskreis reicht das; bei vielen Anmeldungen lässt sich unter *Authentication → Emails →
  SMTP Settings* ein eigener Versand eintragen.
- **Abgleich:** Jede Änderung landet zuerst in einer Warteschlange im Browser und geht zum Server,
  sobald Netz da ist. Ändern zwei Geräte denselben Eintrag, gewinnt die spätere Änderung.
