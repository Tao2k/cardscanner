# Hinweise für Claude

- Die App heißt ScannR; Oberfläche, Kommentare und Commit-Nachrichten sind auf Deutsch.
- **Update-Meldung pflegen:** Jeder Pull Request, der in der App etwas sichtbar ändert (neue Funktion,
  Verbesserung, behobener Fehler), legt eine Datei in `changelog/` an, z. B. `changelog/2026-10-30-stichwort.md`
  mit Zeilen `- Neu: …`, `- Verbessert: …` oder `- Behoben: …`. Nutzerfreundlich, kurz, Du-Form, ohne Technik.
  Format und Regeln: [changelog/README.md](changelog/README.md). Die App zeigt neue Einträge nach dem Update
  einmal als „Neu in Version …“ (`src/app/WhatsNew.tsx`).
- Versionsnummer 1.N entsteht beim Bauen aus den Commits auf `main` (`vite.config.ts`), nicht von Hand.
- Vor dem Push: `npm run typecheck` und `npm test`.
- Design-Skills für die Oberfläche liegen in `.claude/skills/`.
