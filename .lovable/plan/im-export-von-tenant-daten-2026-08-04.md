# Im-/Export von Tenant-Daten

Vollständiger Export als ZIP mit Schema und Editor-Unterstützung, sowie ein selektiver Import mit den Modi „Ersetzen“ und „Ergänzen“. Dazu ein eigener Tab „Im-/Export“ in der Admin-Ansicht.

## Lesbare IDs statt GUIDs

Referenzierbare Objekte (Räume und Farbschemata) bekommen ein zusätzliches, editierbares ID-Feld:

- Standardmäßig leer. Solange es leer ist, wird die ID automatisch aus dem Namen abgeleitet (Kleinbuchstaben, Umlaute umgeschrieben, Sonderzeichen zu `-`). Namensänderungen wirken sich dadurch automatisch auf die ID aus.
- Wird das Feld explizit gefüllt, bleibt es fix und ändert sich bei Namensänderungen nicht.
- Kollisionen werden mit einem Zähler-Suffix (`-2`, `-3`) eindeutig gemacht.
- In der Admin-UI erscheint das Feld bei Räumen und Farbschemata mit einem Platzhalter, der die automatisch abgeleitete ID zeigt.

Im Export- und Importformat werden Referenzen über diese IDs ausgedrückt (`color_scheme: "rot"` statt einer GUID). Einträge referenzieren Räume weiterhin über die Raum-Liste, im JSON aber über die Raum-IDs.

## Export (ZIP)

Der Export-Button erzeugt ein ZIP mit:

```text
tenant-daten.json          alle Daten
tenant-schema.json         JSON Schema (Draft 2020-12)
.vscode/settings.json      bindet das Schema für tenant-daten.json ein
images/logo.png            Logo als Datei
images/ads/01-<name>.png   Ads als Dateien, in Sortierreihenfolge
README.md                  kurze Hinweise zum Bearbeiten und Re-Import
```

Grafiken liegen als echte Dateien im ZIP; im JSON stehen nur relative Pfade (`images/ads/01-foo.png`). Kein Base64 mehr.

## JSON Schema

Ein generiertes Schema beschreibt alle Ebenen; alle Top-Level-Abschnitte (`tenant`, `rooms`, `color_schemes`, `entries`, `ads`, `logo`) sind optional. Damit validiert das Schema sowohl einen Vollexport als auch eine Teil-Import-Datei. Beim Import wird serverseitig gegen die gleiche Struktur geprüft und Fehler werden verständlich gemeldet.

## Import

Der Import akzeptiert eine `.json`-Datei oder ein ZIP (inkl. Bilddateien).

- Es werden nur die Abschnitte importiert, die in der Datei enthalten sind. Zusätzlich lassen sich per Checkbox einzelne Abschnitte abwählen (nur die vorhandenen sind aktivierbar).
- Globale Option „Ersetzen“ / „Ergänzen“:
  - **Ersetzen**: Der jeweilige Abschnitt wird komplett geleert und neu angelegt (z. B. alle Einträge ersetzt).
  - **Ergänzen**: Die Daten werden zusätzlich angelegt. Objekte werden immer neu erzeugt; bei bereits vergebener ID wird die neue ID eindeutig gemacht (Suffix), bestehende Objekte bleiben unverändert.
- `tenant` betrifft nur die Organisationseinstellungen und wird immer als Update angewandt (der Tenant-Key selbst bleibt unverändert).
- Vor dem Ausführen zeigt der Tab eine Vorschau: erkannte Abschnitte mit Anzahl der Objekte und dem gewählten Modus.

## Neuer Tab-Aufbau

Tabs: Einträge · Räume · Farben · Ads · Einstellungen · **Im-/Export**. Der bisherige Import/Export-Block wird aus den Einstellungen entfernt und in den neuen Tab verschoben, dort in zwei Karten gegliedert („Export“, „Import“).

## Technische Umsetzung

- Migration: Spalte `ref_id text` auf `rooms` und `color_schemes` (nullable, unique je Tenant, leer = abgeleitet).
- `src/lib/ref-id.ts`: Ableitung/Slugify und Eindeutigmachung, geteilt von Client und Server.
- `src/lib/tenant-io-schema.ts`: Zod-Schemas als Quelle der Wahrheit; daraus wird das JSON Schema generiert (`zod-to-json-schema`) und beim Export mitgeliefert.
- `src/lib/board.functions.ts`: `exportConfig` liefert Daten + Bilddateien (Base64 nur intern über die RPC-Grenze), `importConfig` erhält Abschnitte und Modus. Das ZIP wird clientseitig mit `fflate` gepackt bzw. beim Import entpackt.
- Neue Komponente `ImportExportPanel` in der Admin-Route; Ads/Räume/Einträge-Panels erhalten das ID-Feld.
