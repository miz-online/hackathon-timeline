# Slides: Dauer pro Bild, Kopfzeile abschaltbar, Umbenennung "Ads" → "Slides"

## Was neu ist

1. **Eigene Anzeigedauer pro Bild**
   Jedes Bild kann eine eigene Dauer in Sekunden bekommen. Bleibt das Feld leer, gilt weiter die Dauer des Sets.

2. **Overlay pro Set abschaltbar**
   Pro Set drei einzelne Schalter: Raumname, Uhr, Logo. Alle drei aus = nur Bilder, vollflächig.

3. **Umbenennung "Anzeigen/Ads" → "Slides"**
   Durchgängig: Oberfläche, Übersetzungen (DE: "Slides"), Import/Export-Datei, Datenbank, Dateiablage, Links. Bestehende Daten werden einmalig mit umgezogen, sodass eingerichtete Bildschirme ohne Nacharbeit weiterlaufen.

## Ablauf der Umbenennung

- Datenbank-Migration: `ad_sets` → `slide_sets`, `ads` → `slides`, Spalten `ad_set_id` → `slide_set_id`, `ad_seconds` → `slide_seconds` (auch in `tenants`).
- Einmaliges Daten-Update: gespeicherte Anzeige-Einstellung `ads` / `ads:<id>` wird zu `slides` / `slides:<id>` (bei Organisationen und Räumen).
- Bilder: neuer Ablageort `tenant-slides`; vorhandene Bilddateien werden einmalig hinüberkopiert, der alte Ablageort bleibt als Rückfall lesbar, bis nichts mehr darauf zeigt.
- Import/Export: Abschnitte heißen künftig `slide_sets` / `slides`, Formatversion steigt auf 6. Ältere Export-Dateien mit `ad_sets` / `ads` werden beim Import weiterhin akzeptiert.

## Technische Details

**Migration (Cloud/Postgres)**
- `ALTER TABLE ... RENAME` für Tabellen und Spalten; neue Spalten:
  - `slides.duration_seconds integer null` (Override, 1–600)
  - `slide_sets.show_room_name/show_clock/show_logo boolean not null default true`
- GRANTs/RLS folgen den umbenannten Tabellen (service-role only wie bisher).
- Template-Strings per `UPDATE` migrieren (`tenants.template`, `rooms.template`).

**Lokale Variante (SQLite)**
- `src/lib/backend/schema.server.ts`: Tabellen-/Spaltennamen angleichen, neue Spalten ergänzen; bestehende Datenbanken werden beim Start per Rename/Add-Column nachgezogen, inkl. Template-Update.
- `local-storage.server.ts`: Bucket-Name `tenant-slides`, alter Ordner als Fallback.

**Code**
- `src/lib/ads.server.ts` → `src/lib/slides.server.ts`: `parseSlidesTemplate`, akzeptiert `slides:`/`slides` und weiterhin `ads:`/`ads`; liefert pro Bild `seconds` (Override oder Set-Wert) und die drei Anzeige-Flags.
- `src/components/templates/AdsTemplate.tsx` → `SlidesTemplate.tsx`: Timer nutzt die Dauer des aktuellen Bildes (Timeout pro Bild statt fixem Intervall); Kopfzeile/Uhr/Logo werden je Flag gerendert.
- `src/routes/api/public/ad.$tenantKey.$adId.ts` → `slide.$tenantKey.$slideId.ts`; Snapshot- und Stream-Routen sowie `board.functions.ts` übernehmen die neuen Feldnamen und Flags.
- Admin (`src/routes/tenant/$tenantKey/index.tsx`): Tab-Key `slides`, Set-Editor mit den drei Schaltern, Bild-Zeile mit optionalem Sekunden-Feld; Query-Keys und Template-Auswahl umbenannt.
- `src/lib/tenant-io.ts`: `slideSetItem`/`slideItem` inkl. `duration_seconds`, `show_*`; JSON-Schema, Sektionsliste und Import-Alias für alte Namen; `ImportExportPanel` Labels.
- `src/lib/i18n.tsx`: Keys `ads.*`/`adSets.*` → `slides.*`/`slideSets.*`, Texte in DE/EN auf "Slides".
- `README.md` und `optional-columns.ts` entsprechend anpassen; Typecheck mit `bunx tsgo --noEmit`.
