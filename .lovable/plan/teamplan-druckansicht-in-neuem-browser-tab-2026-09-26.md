# Teamplan-Druckansicht in neuem Browser-Tab

## Umsetzung
- Die Auswahl „Druckansicht“ im Teamplan öffnet eine eigene Seite in einem neuen Browser-Tab, statt die Teamverwaltung umzuschalten.
- Die neue Seite zeigt ausschließlich den A4-optimierten Teamplan mit Organisationsname, Druckbutton und zweispaltiger, fortlaufend nummerierter Teamliste.
- Teams werden direkt aus derselben gespeicherten, chronologisch sortierten Team-Abfrage geladen; dadurch bleibt die Nummerierung identisch zur Teamverwaltung.
- Raumname, Teilnehmer und Projekt werden wie bisher angezeigt, leere Angaben entfallen.
- Beim Drucken werden alle Bedienelemente ausgeblendet und Teamblöcke nicht über Seiten getrennt.
- Die Seite erhält eigene deutsch/englische Metadaten und funktioniert auf schmalen Bildschirmen einspaltig.

## Technische Details
- Neue TanStack-Seite unter dem jeweiligen Organisationspfad für die Druckansicht.
- Die vorhandene Druckdarstellung wird aus `TeamsPanel` in eine wiederverwendbare Komponente ausgelagert.
- Der Druckansicht-Button verwendet einen normalen Link mit `target="_blank"` und sicherem `rel`-Attribut.
- Die bestehende Formular-/JSON-Umschaltung bleibt unverändert; der interne Druckmodus entfällt.

## Prüfung
- Aufruf aus dem Teamplan öffnet einen separaten Browser-Tab.
- Reihenfolge, Nummerierung und A4-Zweispaltenlayout werden im Browser und in der Druckdarstellung geprüft.
