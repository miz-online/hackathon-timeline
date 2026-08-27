## Technische Umsetzung

Datenbank (additive Migration, greift beim Übernehmen des Drafts):

- `entries.register_token text unique` — kurzer Token; `entries.kind` erhält den Wert `'register'` (Spalte existiert bereits, kein Enum).
- `teams.edit_code text unique`, `teams.self_registered boolean default false`.
- `tenants.team_edit_locked boolean default false`.
- Index auf `entries.register_token`; Teams-Insert läuft über Server-Funktionen mit Service-Role, RLS bleibt service-only wie bei allen anderen Tabellen — keine anon-Grants.

Code:

- `src/lib/practice.ts` bzw. neues `src/lib/registration.ts`: Kind `'register'` in `ENTRY_KINDS`, Token-/Code-Generator (crypto, Alphabet ohne verwechselbare Zeichen).
- `src/lib/board.functions.ts`: Token beim Speichern von Register-Einträgen erzeugen/rotieren; `getRegistration`, `submitRegistration`, `updateRegisteredTeam` als unauthentifizierte Server-Funktionen mit Zod-Validierung (Längenlimits) und Zeitfensterprüfung serverseitig.
- Snapshot/SSE (`getRoomSnapshot`, `snapshot.$tenantKey.$roomId.ts`) geben für Register-Einträge Token/URL mit aus; Hintergrundbild-Felder werden für diesen Typ ignoriert.
- `ZeitplanTemplate.tsx`: QR-Code-Block statt Hintergrundbild bei `kind === 'register'`.
- Neue öffentliche Routen `src/routes/tr/$token.tsx` und `src/routes/tr/$token.$code.tsx` (SSR, kein PIN-Schutz, eigene head()-Metadaten).
- Admin: Eintragsformular-Variante für den Typ, Registrierungs-URL mit Kopieren/Neu-Erzeugen, Settings-Schalter unter „Teams“, Bearbeitungs-URL-Kopie im Teams-Tab.
- Import/Export und die JSON-Editoren (Entries/Teams) um `kind: "register"` bzw. `self_registered` erweitern; Token und Zugangscodes werden nicht exportiert.
- Neues Paket `qrcode` (SVG-Erzeugung, edge-kompatibel) für Display und Bestätigungsseite.
- i18n-Schlüssel für EN/DE.
