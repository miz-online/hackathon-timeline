# Zweite Teamplan-Ansicht im 16:9-Raster

## Umsetzung

- Neben der bestehenden **Druckansicht** einen zweiten Knopf für den **16:9-Teamplan** ergänzen.
- Der neue Knopf öffnet die zweite Ansicht wie die vorhandene Druckansicht in einem eigenen Browser-Tab.
- Die gesamte Planfläche wird im Seitenverhältnis 16:9 dargestellt und enthält ausschließlich die gespeicherten Teams.
- Jedes Team wird als kompakter, abgerundeter Eintrag dargestellt: links die fortlaufende Nummer auf der zugehörigen Raum-/Teamfarbe, rechts nur der Teamname.
- Teams werden in gespeicherter Reihenfolge spaltenweise angeordnet: zuerst von oben nach unten, danach in der nächsten Spalte.
- Zwischen den Spalten erscheint jeweils eine durchgehende vertikale Trennlinie.
- Zeilen- und Spaltenzahl werden aus der Teamanzahl automatisch so gewählt, dass die 16:9-Fläche möglichst gleichmäßig und gut lesbar ausgefüllt wird.
- Die neue Seite erhält eine eigene Druckaktion. In der Browser-Druckvorschau wird ausschließlich der 16:9-Plan ohne Bedienelemente dargestellt.
- Leere Teamlisten erhalten den bestehenden Leerzustand; deutsche und englische Beschriftungen werden ergänzt.

## Technische Details

- Die neue Ansicht bleibt auf einer eigenen TanStack-Seite unter dem Organisationspfad.
- Sie verwendet dieselbe bestehende, geordnete Team-Abfrage wie Verwaltung und Detail-Druckansicht, damit Nummerierung und Reihenfolge identisch bleiben.
- Raum- und Farbschema-Daten bestimmen die Hintergrundfarbe der Nummer; ohne Zuordnung greift weiterhin die Organisationsfarbe.
- Das Raster verwendet eine berechnete Spaltenzahl und CSS-Spaltenfluss, damit die Reihenfolge vertikal je Spalte läuft.
- Für den Ausdruck wird die 16:9-Fläche auf eine einzelne Querformat-Seite skaliert; Navigation und Druckknopf werden ausgeblendet.

## Prüfung

- Beide Knöpfe öffnen jeweils die richtige Ansicht in einem neuen Tab.
- Kleine, mittlere und große Teamanzahlen ergeben ein lesbares, gleichmäßig gefülltes Raster.
- Nummerierung läuft spaltenweise und entspricht exakt der gespeicherten Teamreihenfolge.
- Die Druckvorschau zeigt nur den vollständigen 16:9-Teamplan mit sichtbaren Spaltentrennern.
