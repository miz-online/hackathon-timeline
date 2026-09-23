# Slide-Typ "Einträge" in Slide-Sets

## Was neu ist

- In einem Slide-Set kann neben Bildern ein besonderer Slide **"Einträge"** eingefügt werden.
- Er hat eine eigene, bearbeitbare Dauer (leer = Dauer des Sets) und lässt sich wie Bilder sortieren, bearbeiten und löschen.
- Ist er an der Reihe, zeigt der Bildschirm für diese Zeit den Zeitplan (die Einträge des Raums, live aktualisiert) und blendet danach weich zum nächsten Slide über. Das Slide-Overlay (Raumname/Uhr/Logo) wird dabei nicht zusätzlich eingeblendet, der Zeitplan hat sein eigenes.
- Mehrere "Einträge"-Slides pro Set sind möglich.
- Hinzufügen: Der Knopf "Slides hochladen" bekommt einen Pfeil mit Dropdown (wie bei "Neuer Eintrag"), darin **"Einträge-Slide hinzufügen"**.
- In der Liste erscheint der Slide mit Kalender-Symbol statt Vorschaubild und dem Namen "Einträge" (umbenennbar im Bearbeiten-Dialog).
- Im-/Export enthält den neuen Typ.

## Technische Details

- Migration: `slides.kind text not null default 'image'` (Werte `image` | `entries`), `path`/`content_type` bleiben für `entries` leer (`''`). Gleiches in `schema.server.ts` + `applyMissingColumns` für SQLite.
- `slides.server.ts`: `kind` mitladen, signierte URLs nur für `image`; `SnapshotSlide.kind`.
- `board.functions.ts`: neue Server-Funktion `addEntriesSlide` (Admin), Sortierung ans Ende; Löschen überspringt Storage-Delete bei `entries`; Listen liefern `kind`.
- `SlidesTemplate.tsx`: erhält als Prop eine Render-Funktion für den Zeitplan; bei `kind === 'entries'` wird `ZeitplanTemplate` im Crossfade statt `<img>` gerendert, Overlay ausgeblendet.
- `room/$roomId.tsx`: übergibt die Zeitplan-Props (Einträge, Grace, Fokus etc.) an `SlidesTemplate`; Snapshot liefert Einträge ohnehin mit.
- Admin `tenant/$tenantKey/index.tsx`: Upload-Knopf als Split-Button mit `DropdownMenu`; Listenzeile mit Icon für `entries`.
- `tenant-io.ts`: `slideItem.kind` (default `image`), Export/Import ohne Datei für `entries`; IO_VERSION 9.
- `i18n.tsx`: `slides.addEntries`, `slides.kind.entries` (DE/EN).
