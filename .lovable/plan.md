# Slideshow per Sondereintrag steuern

## Was neu ist

Ein neuer Eintragstyp **Slideshow** legt fest, dass ein Slide-Set zwischen einer Start- und einer Endzeit läuft. Danach wechseln die Bildschirme automatisch zurück zur Zeitplan-Ansicht.

- Beim Anlegen wird gewählt: Slide-Set, Startzeit, Endzeit, optional Raum-Tags.
- Ohne Raum-Tags gilt der Eintrag für alle Bildschirme, mit Tags nur für die getaggten Räume.
- Der Eintrag erscheint nur in der Verwaltung, nicht als Zeile auf den Bildschirmen.
- Überschneiden sich zwei Slideshow-Zeiten, gewinnt die später gestartete.
- Die manuelle Umstellung der Vorlage (Kopfzeile/Einstellungen) bleibt unverändert möglich: fest gewählte Vorlagen (Zeitplan oder ein Slide-Set) gelten immer.
- Neu in der Vorlagen-Auswahl: **Automatisch**. In diesem Modus richtet sich der Bildschirm nach den Zeiteinträgen – während eines Slideshow-Eintrags läuft das Slide-Set, sonst der Zeitplan. Für Organisation und einzelne Räume wählbar.
- Keine Benachrichtigungen für diesen Typ (kein Discord-Post).

## Umschalten in Echtzeit

Die Bildschirme erfahren den Wechsel über die bestehende Live-Verbindung. Zusätzlich liefert der Bildschirm-Datensatz den Zeitpunkt des nächsten Wechsels, sodass der Browser genau dann neu lädt und die Umschaltung sekundengenau statt erst beim nächsten Poll erfolgt.

## Technische Details

**Datenbank**
- `entries.slide_set_id uuid null references slide_sets(id) on delete set null` (Cloud-Migration + `schema.server.ts` für die lokale Variante; `applyMissingColumns` zieht bestehende SQLite-Volumes nach).
- Neuer Wert `slides` in `ENTRY_KINDS` (`src/lib/practice.ts`).

**Server**
- `board.functions.ts`: `slide_set_id` in Insert/Update/Select der Entry-Funktionen; für `kind: "slides"` sind `end_time` und `slide_set_id` Pflicht, `notify` wird auf `false` erzwungen.
- `getRoomSnapshot` / Snapshot-Route: Slideshow-Einträge werden aus `entries` herausgefiltert (nie auf dem Board sichtbar) und separat ausgewertet: aktive Einträge = `time <= now < end_time` und Raum-Tag passt (bzw. keine Tags; Overview-Raum gilt als „alle"). Der aktive Eintrag mit der spätesten Startzeit bestimmt `template = "slides:<slide_set_id>"`, sonst greift wie bisher `room.template || tenant.template`.
- Snapshot bekommt `switch_at`: früheste zukünftige Start-/Endzeit relevanter Slideshow-Einträge.
- Webhook-Dispatch überspringt `kind = 'slides'`.

**Client**
- `room/$roomId.tsx`: Timer auf `switch_at` (+1 s), der den Snapshot neu lädt.
- Admin `tenant/$tenantKey/index.tsx`: Typ-Auswahl um „Slideshow" erweitert; im Formular Slide-Set-Dropdown, Start-/Endzeit Pflicht, Beschreibungs-/Hintergrund-/Benachrichtigungsfelder für diesen Typ ausgeblendet; Listenzeile mit Badge und Set-Namen.
- `i18n.tsx`: Keys für Typ, Slide-Set-Auswahl und Hinweise in DE/EN.

**Import/Export**
- `tenant-io.ts`: `entries[].slide_set_id` als Ref-Id (`slides:<ref>`-Konvention analog zu Templates), Formatversion auf 7; Auflösung Ref → UUID beim Import wie bei bestehenden Set-Referenzen.

Abschluss: `bunx tsgo --noEmit -p tsconfig.json`.
