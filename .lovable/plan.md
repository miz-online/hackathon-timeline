# Vorschauansicht für Zeiteinträge

## Was neu ist

- Im Tab **Zeiteinträge** gibt es neben **Formular** und **JSON** die dritte Ansicht **Vorschau**.
- Die Auswahl der Ansicht bleibt wie bisher im Browser gespeichert.
- Normale Zeit-, Übungs- und Registrierungs-Einträge erscheinen in der Vorschau in ihrer gewohnten Eintragsdarstellung.
- Slideshow-Einträge zeigen statt einer normalen Inhaltsdarstellung den Namen des Slide-Sets und darunter dessen Slides in ihrer festgelegten Reihenfolge **horizontal nebeneinander in genau einer Zeile**.
- Bild-Slides erscheinen als kleine Bildvorschau; ein „Einträge“-Slide erscheint als entsprechende Kalender-Kachel. Die Leiste darf bei vielen Slides horizontal scrollen, statt umzubrechen.
- Der Kopfbereich mit Überschrift, Ansichtsauswahl und „Neuer Eintrag“-Aktion bleibt beim Scrollen am oberen Rand stehen, analog zum Parking-Lot der Teams.
- Abgelaufene Einträge und deren Ein-/Ausblendung folgen auch in der Vorschau der bestehenden Einstellung.

## Technische Details

- Den Ansichtsstatus von `form | json` auf `form | json | preview` erweitern und `entries.mode.preview` auf Deutsch und Englisch ergänzen.
- Die bestehende Eintragsliste in eine wiederverwendbare Darstellung aufteilen, damit die Vorschau normale Einträge konsistent zeigt, ohne Bearbeitungs- und Löschaktionen zu duplizieren.
- Für jeden Slideshow-Eintrag die vorhandene Slide-Liste des gewählten Sets über die bestehende geschützte Server-Funktion und TanStack Query laden und cachen.
- Die Slide-Vorschauleiste mit stabilen 16:9-Kacheln, `flex-nowrap` und horizontalem Overflow umsetzen; fehlende oder gelöschte Sets erhalten einen neutralen Hinweis.
- Den Kopfbereich des Zeiteinträge-Tabs mit `sticky top-0` sowie passendem Hintergrund und Stapelreihenfolge ausstatten, damit Einträge darunter scrollen können, ohne Bedienelemente zu überdecken.
- Abschließend Desktop und die aktuell schmale Ansicht prüfen: Umschalten der drei Ansichten, horizontales Scrollen langer Slide-Reihen und Bedienbarkeit des feststehenden Kopfbereichs.
