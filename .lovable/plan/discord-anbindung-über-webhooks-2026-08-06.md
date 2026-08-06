# Discord-Anbindung über Webhooks

Neuer Admin-Tab **Nachrichten** mit konfigurierbaren Webhook-Zielen. Einträge werden automatisch zu ihrer Eintragszeit gepostet, zusätzlich gibt es Test- und Direktnachrichten.

## Webhook-Verwaltung

Pro Webhook: Name, Typ (aktuell nur `discord`), URL und ein Aktiv-Schalter.

- Die URL wird nach dem Speichern **nie mehr angezeigt** (nur ein Hinweis „gespeichert“ plus die Möglichkeit, sie zu überschreiben), da sie Authentifizierungsdaten enthält.
- Reihenfolge in der Liste wie angelegt; Bearbeiten und Löschen möglich.
- **Test**: Button pro Webhook sendet eine feste Testnachricht („Testnachricht von <Organisation>“) und zeigt Erfolg oder die Fehlermeldung des Ziels an.

## Automatisches Posten bei Fälligkeit

- Ein Eintrag gilt als fällig, sobald seine Eintragszeit erreicht ist.
- Ein minütlicher Server-Job prüft alle Tenants und postet fällige Einträge an **alle aktiven Webhooks** – unabhängig davon, ob ein Raum-Display geöffnet ist.
- Jeder Eintrag wird pro Webhook nur einmal gepostet (Versandprotokoll). Wird ein Eintrag zeitlich in die Zukunft verschoben, kann er erneut fällig werden und wird dann wieder gepostet.
- Gepostet wird nur, was im gerade geprüften Minutenfenster fällig wird. Einträge, deren Zeit davor lag (z. B. vor einer Minute oder nachträglich mit Vergangenheitszeit angelegt), werden nicht gesendet.
- **Opt-out pro Eintrag**: Checkbox „Nicht an Webhooks senden“ im Eintragsformular. Standard ist senden.

## Nachrichtenformat (Discord)

Discord-Webhook mit einem Embed:

- Titel = Eintragstitel, Beschreibung = Beschreibung des Eintrags
- Farbe = Farbschema des Eintrags bzw. die Akzentfarbe des Tenants
- Feld: Zeit (als Discord-Zeitstempel)
- Kein Footer mit Organisationsname.

## Direktnachricht

Im Webhooks-Tab eine Karte „Nachricht senden“ mit denselben Feldern wie ein Eintrag (Titel, Beschreibung, Räume, Farbschema – ohne Zeit) und Auswahl der Ziel-Webhooks. Nichts wird gespeichert, die Nachricht wird direkt gesendet; Ergebnis bzw. Fehler pro Webhook werden angezeigt.

## Im-/Export

- Export enthält Webhooks **ohne URL** (Name, Typ, Aktiv-Status).
- Import kann URLs enthalten und setzt sie; fehlt die URL, wird der Webhook als inaktiv und ohne URL angelegt und im Import-Protokoll als Hinweis gelistet.
- Der Abschnitt `webhooks` kommt ins JSON-Schema und in die Abschnittsauswahl beim Import (Ersetzen/Ergänzen wie bisher).

## Tabs

Einträge · Ads · Räume · Farben · **Nachrichten** · Einstellungen · Im-/Export, inklusive `#messages`-Navigation.

## Technische Umsetzung

- Migration: Tabelle `webhooks` (`tenant_id`, `name`, `type`, `url`, `enabled`, `ref_id`, Timestamps) sowie `webhook_deliveries` (`webhook_id`, `entry_id`, `entry_time`, `sent_at`, unique je Webhook+Eintrag+Zeit). Spalte `notify` (boolean, default true) auf `entries`. Zugriff nur über `service_role`, wie bei den übrigen Tabellen.
- `src/lib/webhooks.ts`: Formatierung der Discord-Payload, geteilt von Job und Direktversand.
- `src/lib/board.functions.ts`: `listWebhooks` (ohne URL, nur `has_url`), `upsertWebhook`, `deleteWebhook`, `testWebhook`, `sendWebhookMessage`; Export/Import um den Abschnitt erweitert.
- `src/routes/api/public/webhooks-dispatch.ts`: Server-Route, die fällige Einträge ermittelt, sendet und protokolliert; per Cloud-Job jede Minute aufgerufen (Authentifizierung über den Anon-Key-Header).
- Neue Komponente `src/components/admin/WebhooksPanel.tsx`; `EntryForm` erhält die Opt-out-Checkbox; i18n-Keys für DE/EN.
