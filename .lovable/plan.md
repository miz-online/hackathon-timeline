# JSON-Editor für Einträge

Der Tab "Einträge" bekommt einen Umschalter zwischen der bestehenden Einzel-Editor-Ansicht und einem JSON-Modus mit Monaco-Editor, in dem alle Einträge als ein Dokument bearbeitet werden.

## Verhalten

- Umschalter (Formular / JSON) oben im Einträge-Tab, Auswahl bleibt beim Tabwechsel erhalten.
- JSON-Modus zeigt ein Objekt `{ "entries": [ ... ] }` mit allen Einträgen, sortiert nach Zeit.
- Jeder Eintrag enthält seine `id` (UUID). Beim Speichern gilt:
  - Eintrag mit bekannter id → wird aktualisiert
  - Eintrag ohne id → wird neu angelegt (id wird generiert)
  - fehlende id (im JSON gelöscht) → Eintrag wird gelöscht
- Speichern zeigt eine Bestätigung mit Zählern (geändert / neu / gelöscht) und lädt danach neu ein; Fehler (Validierung, ungültige Referenzen) werden als Meldung angezeigt, ohne Änderungen anzuwenden.
- Bilder/Hintergründe sind im JSON-Modus nicht bearbeitbar: die Bild-Felder werden nicht angezeigt und beim Speichern unverändert übernommen. Ein kurzer Hinweistext erklärt das.
- Räume und Farbschemata werden im JSON über ihre editierbare Referenz-ID angegeben (wie im Im-/Export), nicht über GUIDs.

## JSON-Schema und Vorlage

- Ein JSON-Schema für die Eintragsliste wird im Editor registriert, damit es Autovervollständigung, Feldbeschreibungen und Inline-Validierung gibt (Zeit, Titel, Beschreibung, Räume, Farbschema, Benachrichtigung).
- Zusätzlich ein Snippet/Template "Neuer Eintrag", das per Autovervollständigung ein vollständiges Eintragsgerüst mit Beispielwerten einfügt, damit man nicht bei Null anfängt.

## Technische Umsetzung

- `monaco-editor` + `@monaco-editor/react` als Dependency; Editor nur clientseitig gerendert (kein SSR-Import), dunkles Theme passend zur Admin-UI.
- Neues Schema-Modul (z. B. `src/lib/entries-json.ts`): JSON-Schema für `{ entries: [...] }` inkl. Beschreibungen, plus Zod-Schema für serverseitige Validierung. Wiederverwendung der Zeit-/Farb-/Raum-Konventionen aus `src/lib/tenant-io.ts`.
- Neue Server-Funktionen in `src/lib/board.functions.ts`:
  - `exportEntriesJson` – liefert die Einträge in JSON-Form (mit id, ref-ids für Räume/Farbschema, ohne Bildfelder)
  - `replaceEntriesJson` – validiert, mappt ref-ids auf UUIDs, führt Update/Insert/Delete in einer Aktion aus, behält Bildfelder bestehender Einträge bei und liefert die Zähler zurück. `notified_at` bleibt über den bestehenden Trigger geregelt.
- Monaco-Completion-Provider registriert das Eintrags-Snippet; Schema-Bindung über `monaco.languages.json.jsonDefaults.setDiagnosticsOptions` mit einem Model-URI.
- i18n-Texte für Umschalter, Speichern, Hinweise und Fehlermeldungen in DE/EN.
