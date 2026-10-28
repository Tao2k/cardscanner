# Online-Sammlung mit Supabase

Die Sammlung liegt bei [Supabase](https://supabase.com); zum Benutzen der App meldet man sich an
(Code per E-Mail). Der Browser hält eine Kopie als Zwischenspeicher, damit Scannen und Ansehen auch
offline gehen; Änderungen warten dann in einer Warteschlange. Karten, die vor der ersten Anmeldung
auf dem Gerät lagen, werden dabei automatisch hochgeladen. Beim Abmelden werden die Karten vom Gerät
entfernt (erst wenn alles gesendet ist). Solange `project.json` leer ist, arbeitet die App wie
früher nur im Browser und fragt nicht nach einer Anmeldung.

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
