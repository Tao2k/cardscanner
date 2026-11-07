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
   genauso [`migrations/0002_friends.sql`](migrations/0002_friends.sql) (Freunde),
   [`migrations/0003_decks.sql`](migrations/0003_decks.sql) (Decks) und
   [`migrations/0004_wishlist.sql`](migrations/0004_wishlist.sql) (Wunschliste),
   [`migrations/0005_wishlist_alarm.sql`](migrations/0005_wishlist_alarm.sql) (Zielpreis für den Preisalarm) und
   [`migrations/0006_albums.sql`](migrations/0006_albums.sql) (eigene Alben),
   [`migrations/0007_cloud_scan.sql`](migrations/0007_cloud_scan.sql) (Tageslimit der Cloud-Hilfe beim Scannen) und
   [`migrations/0008_wishlist_foil.sql`](migrations/0008_wishlist_foil.sql) (Foil-Wunsch auf der Wunschliste).
   Die Skripte dürfen mehrfach laufen.
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
- **Decks:** Decks liegen ebenfalls auf dem Server (Tabelle `decks`, nur für einen selbst sichtbar).
  Fehlt die Tabelle noch, bleiben die Decks auf dem Gerät und werden hochgeladen, sobald es sie gibt.
- **Wunschliste:** Tabelle `wishlist`, nur selbst schreibbar. Bestätigte Freunde lesen sie über
  `friend_wishlist` (nur Karte und Anzahl). Im Tab „Tausch“ kann man außerdem die Binder eines Freundes
  durchblättern; dafür reicht `friend_collection` aus 0002. Fehlt die Tabelle noch, zeigt die App das
  in der Wunschliste an, alles andere läuft weiter.
- **Alben:** Tabelle `albums` (Name und Karten als Liste), nur selbst schreibbar. Bestätigte Freunde lesen
  sie über `friend_albums`. Fehlt die Tabelle noch, blendet die App die Alben einfach aus.

## Cloud-Hilfe beim Scannen (Claude)

Ist ein Scan unsicher, schickt die App das Kamerabild und die besten Treffer an die Funktion
[`functions/identify-card`](functions/identify-card/index.ts). Claude liest Name und Sammlernummer,
vergleicht das Motiv mit den Originalbildern und wählt die Karte. Ist Claude sich sicher, speichert die
App ohne Nachfrage („von Claude bestimmt“), sonst steht Claudes Vorschlag in der Auswahl oben. Ohne
Einrichtung fragt die App wie bisher nach.

1. Bei [console.anthropic.com](https://console.anthropic.com) einen **API-Schlüssel** anlegen und unter
   *Billing* etwas Guthaben aufladen (z. B. 5 $).
2. In Supabase *Edge Functions → Secrets* den Schlüssel als **`ANTHROPIC_API_KEY`** eintragen. Er bleibt
   auf dem Server; die App sieht ihn nie.
3. *SQL Editor*: [`migrations/0007_cloud_scan.sql`](migrations/0007_cloud_scan.sql) ausführen.
4. *Edge Functions → Deploy a new function → Via Editor*: Name **`identify-card`**, den Inhalt von
   [`functions/identify-card/index.ts`](functions/identify-card/index.ts) einfügen und **Deploy** drücken.
   „Verify JWT“ eingeschaltet lassen (nur angemeldete Personen).

**Kosten:** Mit Claude Opus 5.5 kostet eine Anfrage etwa 1 bis 2 Cent (Foto, bis zu 8 kleine Vergleichsbilder,
kurze Antwort). Gefragt wird nur bei unsicheren Scans. Je Person sind höchstens 200 Anfragen am Tag
erlaubt; ändern lässt sich das mit dem Secret `CLOUD_SCANS_PER_DAY`, das Modell mit `CLAUDE_MODEL`
(z. B. `claude-haiku-5-5`, etwa zehnmal günstiger, aber ungenauer beim Lesen).

