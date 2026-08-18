# Übersichts-Raum (Overview / Übersicht)

Ein virtueller Raum, der immer existiert, nicht konfiguriert und nicht gelöscht werden kann und alle Einträge anzeigt.

## Verhalten

- Fester Raum mit der ID `overview`. Er liegt nicht in der Datenbank, sondern wird überall zusätzlich eingeblendet.
- Name: "Übersicht" (DE) / "Overview" (EN), abhängig von der Sprachwahl der Oberfläche.
- Farbgebung: Standard-Akzentfarbe des Mandanten (kein eigenes Farbschema, keine Raum-Vorlage – es gilt die global eingestellte Vorlage).
- Anzeige-Header in diesem Raum: links steht der Organisationsname (an der Stelle des Raumnamens), die Mitte bleibt leer, rechts wie gewohnt die Uhr.
- Inhalt: alle Einträge des Mandanten, unabhängig von den gewählten Räumen/Tags. Vorhandene Regeln zu Ablaufzeit, Karenzzeit und Fokus-Einträgen gelten unverändert.
- Admin-Tab "Räume": ganz oben eine schreibgeschützte Karte für die Übersicht mit Hinweistext und "Anzeige öffnen"-Link, ohne Bearbeiten- oder Löschen-Buttons.
- Raum-Auswahlseite (`/tenant/<key>/rooms`): die Übersicht erscheint als erste Karte.
- Einträge-Formular: die Übersicht taucht nicht in der Raum-Mehrfachauswahl auf, da sie immer alles zeigt. Auch der JSON-Editor und Im-/Export bleiben unverändert.

## Technische Umsetzung

- `src/routes/api/public/snapshot.$tenantKey.$roomId.ts` und `src/routes/api/public/stream.$tenantKey.$roomId.ts`: erkennen `roomId === "overview"`, überspringen die Raum-Abfrage in der Datenbank und liefern ein synthetisches Raum-Objekt (`id: "overview"`, `name: ""`, `color: null`, `template` = globale Mandanten-Vorlage, zusätzliches Flag `is_overview: true`). Die Tag-Filterung auf den Raumnamen wird für diesen Fall übersprungen; im Stream bleiben die Realtime-Abos unverändert (sie hängen an `tenant_id`).
- `src/routes/tenant/$tenantKey/room/$roomId.tsx`: bei `is_overview` wird der lokalisierte Name gesetzt und die Kopfzeilen-Variante gewählt; die Filterung auf "heutige Einträge" bleibt wie bisher.
- `src/components/templates/ZeitplanTemplate.tsx` (und `AdsTemplate.tsx`, falls global auf Ads gestellt): neues optionales Prop, das den Organisationsnamen an die Stelle des Raumnamens setzt und die Mitte leer lässt.
- `src/routes/tenant/$tenantKey/index.tsx` (Räume-Tab) und `src/routes/tenant/$tenantKey/rooms.tsx`: statische erste Karte für die Übersicht, verlinkt auf `/tenant/$tenantKey/room/overview`.
- `src/lib/i18n.tsx`: neue Schlüssel für Name und Hinweistext der Übersicht (DE/EN).
- Keine Datenbank-Migration nötig.
