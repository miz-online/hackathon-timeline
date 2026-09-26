# Druckansicht für den Teamplan

## Umsetzung

- Im Bereich **Teams** neben „Formular“ und „JSON“ einen neuen Tab **Druckansicht** ergänzen.
- Teams in ihrer gespeicherten Reihenfolge anzeigen und fortlaufend nummerieren.
- Pro Team Name, Teilnehmer, Projekt und zugeordneter Raum darstellen; leere Angaben werden ausgelassen.
- Die Druckansicht auf dem Bildschirm als klare Vorschau und beim Drucken als zweispaltiges A4-Blatt ausgeben.
- Eine gut sichtbare Aktion **Drucken** ergänzen, die den Browser-Druckdialog öffnet.
- Beim Druck Navigation, Tabs und andere Verwaltungsbereiche ausblenden; nur Titel und Teamplan drucken.
- Seitenumbrüche innerhalb eines Teams vermeiden und bei schmalen Bildschirmen auf eine Spalte wechseln.
- Deutsche und englische Beschriftungen ergänzen.

## Technische Details

- Die Ansicht bleibt Teil des bestehenden Teams-Bereichs und verwendet dieselben bereits geladenen Teamdaten.
- Druckregeln werden lokal für die Team-Druckansicht definiert, einschließlich A4-Rändern und zweispaltigem Raster.
- Geparkte, noch nicht gespeicherte Teams erscheinen nicht in der Druckansicht; maßgeblich ist die gespeicherte Reihenfolge.
