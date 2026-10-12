# CardScanner

Sammelkarten mit der Handykamera erkennen und als eigene Sammlung erfassen. Start mit **Riftbound**, aufgebaut für weitere TCGs.

## So funktioniert es

- **Web-App fürs Handy (PWA):** Link öffnen, „Zum Startbildschirm hinzufügen“. Kein App-Store, kein Konto.
- **Live-Scan:** Karte in den Rahmen halten. Sobald die Erkennung über mehrere Bilder stabil ist, wird die Karte sofort gespeichert. Knappe Treffer landen unter „Prüfen“.
- **Erkennung auf dem Gerät:** Ein Bildmodell ([DINOv2 small](https://huggingface.co/Xenova/dinov2-small)) berechnet einen Vektor des Kamerabilds und sucht die ähnlichste Referenzkarte. Kein Training pro Karte nötig.
- **Daten bleiben lokal:** Jede Person hat ihre Sammlung nur im Browser ihres Geräts. Export und Import als Excel (`.xlsx`).

## Aufbau

```
scripts/adapters/     Anbindung je Spiel an seine Kartendatenquelle (Riftbound → offizielle Kartengalerie)
scripts/build-catalog Katalog + Embeddings bauen (läuft in GitHub Actions)
src/core/             Datenmodell, Suche, Stabilisierung, Sammlung, Excel – ohne UI
src/storage/          Speicher-Interface; heute IndexedDB, später austauschbar gegen einen Server
src/app/              Oberfläche (Preact), Kamera, Erkennungs-Worker
```

**Sprachen:** Riftbound wird auf Englisch, Französisch und vereinfachtem Chinesisch erfasst. Die Sprache gehört zum gesammelten Exemplar, nicht zum Druck; beim Scannen wird sie oben gewählt. Riot veröffentlicht französische Kartenbilder bisher nicht, französische Karten werden daher über das englische Bild erkannt. Für etwa 560 Karten gibt es eigene chinesische Bilder, die zusätzlich im Index stehen.

**Neues Spiel:** Adapter in `scripts/adapters/` schreiben (Interface `GameAdapter`), in `index.ts` registrieren und im Workflow einen weiteren `npm run catalog -- <spiel>` aufrufen.

**Server später:** `CollectionStore` (`src/storage/store.ts`) mit einer HTTP-Umsetzung implementieren. Die App spricht nur über dieses Interface mit dem Speicher; Excel-Export und -Import bleiben gleich.

## Entwicklung

```bash
npm install
npm test
npm run catalog -- riftbound --limit 30   # kleiner Testkatalog (braucht Internet)
npm run dev
```

Die Kamera funktioniert nur über HTTPS oder `localhost`.

## Veröffentlichen

Jeder Push auf `main` und jeden Montag baut die GitHub-Action den Katalog neu und veröffentlicht die App auf GitHub Pages. Einmalig nötig: unter *Settings → Pages* als Quelle **GitHub Actions** wählen.

## Rechtliches

CardScanner was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

Kartendaten und Bilder stammen aus der [offiziellen Riftbound-Kartengalerie](https://playriftbound.com/en-us/card-gallery/). Die App liefert nur Embeddings aus und zeigt Kartenbilder über die Original-URLs an. ([Riftcodex](https://riftcodex.com) wäre eine Alternative, sperrt aber Anfragen aus GitHub Actions.)
