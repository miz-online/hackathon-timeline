# Registrierung: Bearbeitungsseite reparieren + „erstes Mal“-Ansicht

## Ursache des Fehlers (verifiziert)

`src/routes/tr/$token.tsx` ist durch die Kindroute `$token.$code.tsx` automatisch zur
Eltern-Route geworden (im generierten Routenbaum: `TrTokenRouteWithChildren`), rendert aber
weiterhin das Registrierungsformular und **kein `<Outlet />`**. Deshalb zeigt `/tr/<token>/<code>`
das leere Neu-Registrierungsformular statt der Team-Bearbeitung — und ein Absenden legt ein
neues Team an.

## Umsetzung

1. `tr/$token.tsx` wird zur reinen Layout-Route: rendert nur `<Outlet />` (plus das gemeinsame
   `Shell`, das exportiert bleibt).
2. Das bisherige Registrierungsformular zieht unverändert nach `tr/$token.index.tsx` (URL
   bleibt `/tr/<token>`), mit eigenem `head()`.
3. Nach erfolgreicher Registrierung wird direkt auf `/tr/<token>/<code>` navigiert —
   diese URL ist die bookmarkbare Team-Seite.

## „Das erste Mal“ — technischer Vorschlag

Lokaler Merker, ohne URL-Parameter und ohne neue Datenbankspalte:

- Nach erfolgreicher Registrierung wird `localStorage["tr-seen:<code>"] = "1"` gesetzt.
- Beim Laden der Bearbeitungsseite prüft die Komponente, ob dieser Schlüssel bereits
  existiert. Falls nicht, zeigt sie oben einen Erfolgs-/Willkommensblock:
  Kurzbeschreibung, Link zum Kopieren und den Hinweis „Diese Seite als Lesezeichen speichern“
  (inkl. Hinweis auf Strg/Cmd+D).
- Bei späteren Aufrufen (z. B. aus einem Lesezeichen) wird der Block nicht mehr angezeigt.
  So bleibt genau der erste Besuch besonders, ohne Serverzustand.

## Weitere Details

- Der Block ist zusätzlich jederzeit über einen kleinen Link „Link teilen“ einklappbar
  erreichbar, damit der Code nicht verloren geht.
- Neue i18n-Schlüssel (EN/DE) für Willkommenstext und Bookmark-Hinweis.
- Server-Funktionen und Datenmodell bleiben unverändert.
