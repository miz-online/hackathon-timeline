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
3. Nach erfolgreicher Registrierung wird direkt auf `/tr/<token>/<code>?new=1` navigiert —
   diese URL ist die bookmarkbare Team-Seite.

## „Das erste Mal“ — technischer Vorschlag

Kombination aus URL-Parameter und lokalem Merker, ohne neue Datenbankspalte:

- Die Weiterleitung nach der Registrierung setzt `?new=1`.
- Ist `new=1` gesetzt, zeigt die Bearbeitungsseite oben einen Erfolgs-/Willkommensblock:
  Kurzbeschreibung, Link zum Kopieren und den Hinweis „Diese Seite als Lesezeichen speichern“
  (inkl. Hinweis auf Strg/Cmd+D).
- Gleichzeitig wird `localStorage["tr-seen:<code>"] = "1"` gesetzt. Bei späteren Aufrufen —
  auch wenn die gemerkte URL noch `?new=1` enthält — wird der Block nicht mehr angezeigt.
  So bleibt genau der erste Besuch besonders, ohne Serverzustand.

## Weitere Details

- Der Block ist zusätzlich jederzeit über einen kleinen Link „Link teilen“ einklappbar
  erreichbar, damit der Code nicht verloren geht.
- Neue i18n-Schlüssel (EN/DE) für Willkommenstext und Bookmark-Hinweis.
- Server-Funktionen und Datenmodell bleiben unverändert.
