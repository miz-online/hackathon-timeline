# Dateien: Bearbeiten-Dialog, eigener Einstellungs-Bereich, Team-Dateien im Admin, ZIP, Team-Link mit QR

## 1. Datei umbenennen wird "Bearbeiten"-Dialog

In der Dateiliste ersetzt ein Stift-Button ("Bearbeiten") das Inline-Umbenennen. Er öffnet
einen Dialog mit dem Dateinamen als Eingabefeld sowie Größe, Typ und Datum als Info,
mit "Speichern" und "Abbrechen". Gilt überall, wo Bearbeiten erlaubt ist.

## 2. Datei-Einstellungen in eigenen Bereich "Dateien"

In den Einstellungen kommt neben Allgemein/Anzeige/Teams/Logo/Webhooks/Organisation ein
neuer Bereich "Dateien". Dorthin wandern die bisher unter "Teams" liegenden Felder:
Datei-Modus (Aus / nur Downloads der Organisation / Hoch- und Herunterladen) und
maximale Dateigröße in MB. Gespeichert wird weiter über den bestehenden Speichern-Button.

## 3. Alle Team-Dateien im Dateien-Tab

Unter "Downloads der Organisation" erscheint ein zweiter Abschnitt "Dateien der Teams":
eine flache Liste aller Team-Dateien der Organisation, jede Zeile mit Team-Namen als
Kennzeichnung, Größe und Datum, dazu Herunterladen und Löschen. Sortiert nach Team und
Dateiname. Filterfeld zum Suchen nach Team oder Dateiname.

## 4. Sammel-Download als ZIP

Im Abschnitt "Dateien der Teams" gibt es "Alle als ZIP herunterladen"; zusätzlich lassen sich
einzelne Teams und einzelne Dateien per Häkchen auswählen und als ZIP laden. Das ZIP enthält je Team einen Ordner mit den Originaldateien.
Erscheint nur, wenn Dateien vorhanden sind.

## 5. Selbstverwaltungs-Link mit QR-Code im Team-Bereich

Pro Team ein Button "Link" in der Teamverwaltung. Er öffnet einen Dialog mit der
Selbstverwaltungs-Adresse des Teams, Kopieren-Button und QR-Code (mit Möglichkeit, den
QR-Code als Bild zu speichern) — damit Teams ihren verlorenen Link zurückbekommen.
Fehlt einem Team noch ein Bearbeitungscode (im Admin angelegte Teams), wird er beim ersten
Öffnen erzeugt. Existiert kein Registrierungs-Eintrag, aus dem sich die Adresse ableiten
lässt, erklärt der Dialog das in einem Hinweis statt einen ungültigen Link zu zeigen.

## Technische Umsetzung

- `src/components/FileList.tsx`: `canRename` → Bearbeiten-Dialog (shadcn `Dialog`),
  optionale `tag`-Spalte pro Eintrag, optionale Kopfzeilen-Aktion (für ZIP-Button) und
  optionales Filterfeld. Bestehende Props bleiben kompatibel.
- `src/lib/files.functions.ts`:
  - `listAllTeamFiles({ key })` — alle `team_files` der Organisation, mit `team_id` und
    Team-Namen (join über `teams`), sortiert.
  - `renameTeamFile({ key, id, name })` analog zu `renameTenantFile`.
  - `getTeamFilesZipUrl({ key, teamId? })` — signiertes Token via `signFileToken`-Variante
    (neuer Payload-Typ `z` mit tenant_id + optional team_id, kurze TTL) und URL auf die
    neue Route.
  - `getTeamSelfUrl({ key, teamId })` — sichert `edit_code` (erzeugt fehlenden Code),
    wählt Basis-Token eines `register`-Eintrags (bevorzugt Eintrag mit passendem Raum-Tag,
    sonst erster), gibt `{ path: "/tr/<token>/<code>" }` oder `{ reason: "no-token" }`.
- Neue Route `src/routes/api/public/files-zip.ts`: prüft Token, lädt Objekte über
  `fileStorage().get`, baut ZIP mit `fflate` (`zipSync`) mit Ordnern
  `<team-name>/<dateiname>`, antwortet mit `application/zip` + `Content-Disposition`.
- `src/components/admin/TenantFilesPanel.tsx` bleibt; neue
  `src/components/admin/AllTeamFilesPanel.tsx` für Abschnitt 3 + 4.
- `src/components/admin/TeamsPanel.tsx`: Link-Button pro Team, Dialog mit
  `qrcode` (`toDataURL`) und Kopieren; Datei-Dialog unverändert.
- `src/routes/tenant/$tenantKey/index.tsx`: Settings-Bereich `files` ergänzt, Felder aus
  `teams` dorthin verschoben; Dateien-Tab um `AllTeamFilesPanel` erweitert.
- `src/lib/i18n.tsx`: neue DE/EN-Texte (files.edit, files.tag, files.allTeams,
  files.zipAll, files.zipTeam, files.filter, teams.link, teams.linkQr, teams.linkMissing,
  settings.sec.files).
- Keine Schema-Änderung nötig.
