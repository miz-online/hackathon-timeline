# Hintergrundbild für Einträge

Jeder Eintrag kann ein eigenes Hintergrundbild bekommen, mit eigenen Einstellungen für Ausrichtung, Höhe und Deckkraft. Das Bild wird im Raum-Display (Zeitplan-Template) hinter dem Eintrag gezeichnet.

## Eintrags-Editor

Im Editor-Dialog (linke Spalte, unter der Farb-/Posting-Konfiguration) ein neuer Block „Hintergrundbild“:

- Upload (PNG, JPG, WebP, GIF/animiert), Vorschau als kleines 16:9-Feld, Download-Link, Entfernen-Button.
- Ausrichtung (Auswahl):
  - **Rechts oben** – Bild rechts, oben ausgerichtet, Höhe = konfigurierte Bildhöhe
  - **Rechts unten** – Bild rechts, unten ausgerichtet, Höhe = konfigurierte Bildhöhe
  - **Rechts gestreckt** – Bild rechts, füllt die volle Eintragshöhe
  - **Füllen** – Bild deckt den ganzen Eintrag ab, Überstände werden abgeschnitten
  - **Zeit** – Bild sitzt in der Zeitspalte unterhalb der Uhrzeit, auf Spaltenbreite skaliert
- Bildhöhe in Pixel: nur bei „Rechts oben“ und „Rechts unten“ aktiv (Standard 80 px).
- Deckkraft: 0–100 % (Standard 100 %).

Das Seitenverhältnis wird in allen Modi eingehalten. Das Bild verändert die Eintragshöhe nicht – Überstände werden abgeschnitten. Einzige Ausnahme: bei Ausrichtung „Zeit“ bestimmt das Bild (Breite der Zeitspalte × Seitenverhältnis) die Zellenhöhe mit.

## Raum-Anzeige

- Bild liegt hinter Text und Rahmen, Ecken folgen der Eintragsrundung, alles Überstehende wird abgeschnitten.
- „Zeit“: Bild wird unterhalb von Uhrzeit/Untertitel in der farbigen Zeitspalte eingefügt, auf deren Breite gestreckt; die Spalte wächst entsprechend, wodurch der Eintrag höher wird.
- Glow-/Puls-Animation bei „NOW“ bleibt unverändert und bleibt über dem Bild sichtbar.

## Im-/Export

- Bilder liegen im ZIP unter `images/entries/<nn>-<name>.<ext>`, im JSON nur der relative Pfad plus die Einstellungen (`background_align`, `background_height`, `background_opacity`).
- Import: fehlende Bilddateien werden als Warnung gemeldet, der Eintrag wird ohne Bild angelegt. JSON-Schema und Version des Exportformats werden entsprechend erweitert.

## Technische Umsetzung

- Migration: `entries` erhält `background_path text`, `background_content_type text`, `background_align text default 'right-top'` (Check auf die fünf Werte), `background_height int default 80`, `background_opacity int default 100`.
- Neuer Storage-Bucket `tenant-entry-backgrounds` (service-role-only Policies, analog zu `tenant-ads`).
- `src/lib/board.functions.ts`: `uploadEntryBackground` / `removeEntryBackground`; `listEntries` und `getSnapshot`/SSE liefern eine signierte URL bzw. Public-Route-URL sowie die Anzeigeoptionen mit; Löschen eines Eintrags bzw. Tenants räumt die Storage-Dateien auf.
- Neue öffentliche Route `src/routes/api/public/entry-bg.$tenantKey.$entryId.ts` analog zu `ad.$tenantKey.$adId.ts`, damit das Display ohne Signatur-Ablauf funktioniert.
- `src/components/templates/ZeitplanTemplate.tsx`: Entry-Typ um Bildfelder erweitert, Hintergrund-Layer je Ausrichtung, Zeitspalte um Bildbereich ergänzt.
- `src/lib/tenant-io.ts` (`entryItem`, `IO_VERSION`) und Export/Import in `board.functions.ts` erweitern; Editor-Dialog in `src/routes/tenant/$tenantKey/index.tsx`; neue Übersetzungen in `src/lib/i18n.tsx`.
