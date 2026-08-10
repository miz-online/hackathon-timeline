# PIN-Schutz für die Tenant-Verwaltung

Die Admin-Ansicht eines Tenants kann optional mit einer PIN bzw. einem Passwort geschützt werden. Raumansichten und die öffentlichen Endpunkte (Stream, Snapshot, Ads, Logo) bleiben unverändert frei zugänglich.

## Verhalten

- Ist für einen Tenant keine PIN gesetzt (leer), gibt es keine Abfrage — Verhalten wie heute. Bestehende Tenants haben keine PIN.
- Ist eine PIN gesetzt, zeigt die Admin-Ansicht eine Sperr-Karte mit einem Eingabefeld (beliebige Länge, Passwort-Feld) und Fehlermeldung bei falscher Eingabe.
- Nach korrekter Eingabe wird der Zugang in einem verschlüsselten, httpOnly-Cookie hinterlegt: 4 Stunden gültig, und bei jeder Admin-Seiten- oder Admin-Serveraktion automatisch wieder auf 4 Stunden verlängert (Sliding Expiry). Nach 4 Stunden Inaktivität ist erneut eine Eingabe nötig.
- Der Cookie gilt pro Tenant; mehrere Tenants können gleichzeitig freigeschaltet sein.
- An der Stelle, an der heute „Exit“ im Admin-Header steht, wird dieser durch einen Sperren-Button mit Schloss-Icon ersetzt. Der Button sperrt die aktuelle Tenant-Freischaltung und verlässt den Tenant.

## Änderung im Admin-Bereich

Neue Karte in den Einstellungen: „Zugangsschutz“
- Aktuelle PIN (nur nötig, wenn bereits eine gesetzt ist)
- Neue PIN + Wiederholung
- Leer lassen entfernt den Schutz
- Anzeige, ob der Schutz aktiv ist

## Neuanlage

Beim Anlegen eines neuen Tenants kann optional direkt eine PIN/ein Passwort gesetzt werden (Feld optional, leer = kein Schutz).

## Sicherheit

- PIN wird nie im Klartext gespeichert: PBKDF2-SHA-256 mit zufälligem Salt und hoher Iterationszahl, gespeichert als einzelner Hash-String.
- Vergleich zeitkonstant; bei Fehlversuchen eine generische Fehlermeldung.
- Der Schutz wird serverseitig in jeder Admin-Serverfunktion erzwungen, nicht nur in der UI — ein direkter Aufruf ohne gültigen Cookie schlägt fehl.

## Technische Umsetzung

- Migration: `tenants.pin_hash text null`. Bestehende Zeilen bleiben `null` (kein Schutz).
- `SESSION_SECRET` wird als Secret generiert (verschlüsselt den Cookie).
- Neues Modul `src/lib/tenant-auth.server.ts`: Hash/Verify (PBKDF2 über WebCrypto), Session-Config (`useSession`, `maxAge` 4 h, httpOnly/secure/sameSite lax), `unlockTenant`, `isTenantUnlocked(tenantId)` mit Refresh der Session bei jedem Aufruf, `lockTenant`.
- Neues Modul `src/lib/tenant-auth.functions.ts`: `getTenantAccess` (liefert `{ protected, unlocked }`), `unlockTenantAccess`, `lockTenantAccess`, `setTenantPin`.
- `src/lib/board.functions.ts`: Helper `requireTenantAdmin(key)` (löst Tenant auf und prüft Session; wirft bei fehlendem Zugang). Alle Admin-Serverfunktionen (Entries, Rooms, Colors, Ad-Sets/Ads, Webhooks, Settings, Template, Logo, Import/Export, Tenant löschen) nutzen ihn anstelle von `resolveTenant`. Öffentliche Pfade (`getRoomSnapshot`, Raum-Routen, `api/public/*`, `createTenant`) bleiben ungeschützt.
- `createTenant` erhält ein optionales `pin`-Feld und setzt beim Anlegen direkt die Freischaltung.
- `src/routes/tenant/$tenantKey/index.tsx`: Gate-Komponente vor dem Admin-UI (PIN-Formular), „Sperren“-Link im Header, neue Einstellungs-Karte für die PIN.
- `src/routes/index.tsx`: optionales PIN-Feld beim Erstellen eines Tenants.
- i18n-Keys (DE/EN) für Gate, Fehlermeldungen, PIN-Karte und Sperren.
