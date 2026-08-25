# Teams & Übungszeiten

## Was entsteht

Ein neuer Admin-Bereich "Teams" plus ein spezieller Eintragstyp "Übungszeit", dessen Dauer sich automatisch aus der Anzahl der Teams und einer Einstellung ergibt. Im Raum-Display wird der Übungsblock nicht als ein Eintrag gezeigt, sondern als ein Eintrag pro Team.

## Teams

- Neue Tabelle `teams`: Name, Teilnehmer (freie Texteingabe, komma-separiert), Projektbeschreibung, optionale Raumzuordnung, Sortierung, `ref_id` (synthetisch aus dem Namen, wie bei Räumen/Farben).
- Neuer Tab "Teams" im Admin (zwischen Räume und Farben) mit Anlegen / Bearbeiten / Löschen im Dialog-Portal (wie überall sonst).
- Reihenfolge per Auf/Ab-Buttons und Drag & Drop — genau wie bei Ads.
- Ein Team ohne Raum gilt als raumübergreifend.

## Einstellungen (neuer Unterbereich "Teams")

- Übungszeit pro Team in Minuten.
- Schalter: Übungszeiten nur im zugeordneten Raum anzeigen, oder in allen Räumen. Teams ohne Raumzuordnung erscheinen in beiden Fällen in allen Räumen.

## Eintrag "Übungszeit"

- Im Einträge-Tab bleibt "Neuer Eintrag" die Hauptaktion; direkt daneben ein Dropdown-Pfeil als Sekundäraktion "Übungszeit".
- Der Übungseintrag hat Startzeit, Titel und Hintergrundbild (inkl. seiner Einstellungen, die für alle Team-Zeilen gelten) — keine Beschreibung, keine Raumauswahl und kein Farbschema, da sich beides über die Räume der Teams ergibt; nicht zugeordnete Teams nutzen die Standardfarbe. Das Endzeit-Feld ist gesperrt und zeigt die berechnete Endzeit (Start + Anzahl Teams × Übungszeit) als Hinweis an.
- Mehrere Übungseinträge sind möglich; jeder spannt die volle Team-Liste auf.

## Anzeige im Raum

Aus einem Übungseintrag werden im Display so viele Zeilen wie Teams:

```text
Übungszeit ab 14:00, 10 min/Team
14:00 - 14:10   Team Alpha
14:10 - 14:20   Team Beta
14:20 - 14:30   Team Gamma
```

- Titel = Teamname (Teilnehmer und Projektbeschreibung bleiben admin-intern).
- Farbgebung: Farbschema des zugeordneten Raums des Teams; ohne Raum das Farbschema des Übungseintrags bzw. die Standardfarbe.
- Jede Team-Zeile verhält sich wie ein normaler Eintrag: eigene Start/Endzeit, "in x min", "JETZT / bis hh:mm", Ausblenden nach Ablauf, Fokus-Logik, Hintergrundbild des Übungseintrags.
- Raumfilter: Die Raum-Tags des Übungseintrags entscheiden, ob der Block im Raum überhaupt vorkommt. Zusätzlich greift die Einstellung oben: bei "nur zugeordneter Raum" zeigt ein Raum nur die Teams, die ihm zugeordnet sind (plus Teams ohne Raum); im Übersichts-Raum immer alle.

## Import/Export

- Neue Sektion `teams` (id, name, members, project, room, Reihenfolge über Array-Position) in Schema, Export und Import inkl. Replace/Append.
- Neue Tenant-Felder (Übungsminuten, Anzeige-Scope) und der Eintragstyp im Eintrags-Schema (JSON-Editor inkl. Snippet und Validierung).

## Technische Umsetzung

- Migration: Tabelle `public.teams` (mit GRANTs für `service_role`, RLS + service-only Policy wie bei `ad_sets`), `tenants.practice_minutes` (Default 10) und `tenants.practice_room_scope` (`'assigned' | 'all'`, Default `'all'`), `entries.kind` (`'entry' | 'practice'`, Default `'entry'`).
- `src/lib/board.functions.ts`: `listTeams`, `upsertTeam`, `deleteTeam`, `moveTeam`, `reorderTeams` analog zu den Ads-Funktionen; `getRoomSnapshot` und `src/routes/api/public/snapshot.$tenantKey.$roomId.ts` expandieren Practice-Einträge serverseitig in Team-Zeilen (gemeinsamer Helper, damit SSE-Stream und Snapshot identisch sind).
- `RoomSnapshot`-Entry erhält optionale Felder für die synthetische Herkunft (`team_id`), damit React stabile Keys hat; der Zeitplan-Template-Code bleibt unverändert außer der Datenquelle.
- Admin-UI in `src/routes/tenant/$tenantKey/index.tsx` (neuer Tab + Settings-Unterbereich) und ein `TeamsPanel` in `src/components/admin/`.
- i18n-Schlüssel für EN/DE ergänzen.
- Webhook-Versand bleibt am Übungseintrag selbst (ein Post zur Startzeit), nicht pro Team.
