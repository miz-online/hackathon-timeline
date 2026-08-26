# Team-Selbstregistrierung

Teams tragen sich selbst ein: Im Raum-Display erscheint zur Registrierungszeit ein Eintrag mit QR-Code und kurzer URL. Wer sie öffnet, legt ein Team an (Titel, Teilnehmer, Projektbeschreibung) und bekommt danach eine eigene Bearbeitungs-URL mit Zugangscode in der URL zum Merken — damit lässt sich das Team auch nach Ende der Registrierungszeit noch ändern.

## Neuer Eintragstyp "Registrierung"

- Dritte Variante neben "Neuer Eintrag" und "Teamzeit" (gleiches Dropdown).
- Felder: Startzeit, Endzeit, Titel, Beschreibung. Kein Raum, kein Farbschema — der Eintrag wird in allen Räumen eingeblendet. Kein Hintergrundbild (Bild-Bereich wird für diesen Typ ausgeblendet).
- Beim Anlegen wird ein kurzer, nicht erratbarer Token erzeugt (10 Zeichen, Krypto-Zufall) → öffentliche URL `<domain>/tr/<token>`.
- Im Admin-Formular wird die URL angezeigt, mit Kopieren-Button und Möglichkeit, den Token neu zu erzeugen (alte URL wird damit ungültig).

## Anzeige im Raum

Der Eintrag rendert wie ein normaler Eintrag (Zeit, Titel, Beschreibung). Die URL `<domain>/tr/<token>` wird automatisch an die Beschreibung angehängt; zusätzlich rechts ein QR-Code. Der QR-Code nimmt den Platz ein, den sonst das Hintergrundbild hätte. Tenant-Logo und Tenant-Titel bleiben im bestehenden Layout oben sichtbar; die Karte selbst nutzt die Akzentfarbe des Tenants.

## Öffentliche Registrierungsseite

- `/tr/<token>` ist nur zwischen Start- und Endzeit des Eintrags aktiv.
- Davor/danach: Hinweisseite "Registrierung nicht geöffnet — bitte an die Organisatoren wenden".
- Formular: Teamname, Teilnehmer (komma-separiert), Projektbeschreibung. Der Raum ist vorbelegt: jedes Display zeigt einen QR-Code mit angehängtem kurzen Raum-Kürzel (`/tr/<token><raum-ziffer>`, 1 Zeichen, also weiterhin sehr kurz), das den Raum des Displays bestimmt. Das Feld bleibt änderbar; ohne Kürzel (Übersicht) entsteht das Team ohne Raum und der Admin ordnet zu.
- Nach dem Absenden: Bestätigungsseite mit der persönlichen Bearbeitungs-URL `domain/tr/<token>/<zugangscode>`, QR-Code dazu und deutlichem Hinweis, sie zu speichern.

## Bearbeitungs-URL

- Öffnet das gleiche Formular vorbelegt; Speichern aktualisiert das Team, auch nach Ablauf der Registrierungszeit.
- In den Einstellungen (Bereich "Teams") ein Schalter "Team-Bearbeitung gesperrt". Ist er aktiv, zeigt die Seite die Daten nur noch lesend mit dem Hinweis, sich an die Organisatoren zu wenden.
- Im Teams-Tab bekommt jedes selbst registrierte Team ein Icon zum Kopieren seiner Bearbeitungs-URL.
