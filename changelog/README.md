# Änderungen für die Update-Meldung

Nach einem Update zeigt ScannR beim ersten Öffnen ein Blatt „Neu in Version …“ mit allen Punkten,
die das Gerät noch nicht gesehen hat. Unter *Einstellungen → Was ist neu?* steht der ganze Verlauf.

**Jede Änderung, die man in der App merkt, bekommt hier eine eigene Datei**, im selben Pull Request:

```
changelog/2026-10-30-update-meldung.md
```

- Name: `JJJJ-MM-TT-stichwort.md` (Datum der Änderung, Stichwort klein mit Bindestrichen). Der Name ist die
  feste Kennung, also nach dem Mergen nicht mehr umbenennen, sonst erscheint der Eintrag noch einmal.
- Inhalt: eine Zeile pro Punkt, beginnend mit `- Neu:`, `- Verbessert:` oder `- Behoben:`. Andere Zeilen
  (Überschriften, Notizen) zeigt die App nicht.
- Für Nutzerinnen und Nutzer geschrieben: Deutsch, kurz, in Du-Form, ohne Technik, PR-Nummern oder Dateinamen.
  Was ändert sich beim Benutzen? Ein bis drei Punkte reichen meist.
- Reine Technik ohne sichtbare Wirkung (Tests, Skripte, Refactoring) braucht keinen Eintrag.

Beispiel:

```
- Neu: Nach einem Update zeigt die App einmal, was sich geändert hat.
- Behoben: Der Binder klappt nicht mehr von selbst zu.
```

Neue Nutzer sehen keine Meldung; ihre App merkt sich beim ersten Start alle vorhandenen Einträge als gesehen.
