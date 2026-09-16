# Dateien für Teams (Upload/Download) + globale Downloads

## Was entsteht

1. **Team-Dateien**: Jedes Team kann in der Selbstverwaltung Dateien hochladen, herunterladen und löschen. Im Admin-Bereich sieht und verwaltet die Organisation die Dateien aller Teams (inkl. Löschen und eigenem Upload für ein Team).
2. **Globale Dateien**: Im Admin-Bereich kann die Organisation Dateien bereitstellen, die alle Teams herunterladen, aber nicht ändern oder löschen können.

Sichtbarkeit: Ein Team sieht nur seine eigenen Dateien plus die globalen Downloads. Andere Teams sind nicht sichtbar.

## Selbstverwaltung (Team-Seite)

Zwei klar getrennte Bereiche unterhalb der Team-Angaben:

- **Meine Dateien**: Liste mit Name, Größe, Datum; Buttons Hochladen (auch mehrere auf einmal), Herunterladen, Löschen.
- **Downloads der Organisation**: schreibgeschützte Liste, nur Herunterladen.

Ist die Team-Bearbeitung gesperrt (bestehender Schalter), sind Upload und Löschen deaktiviert; Herunterladen bleibt möglich.

## Adminbereich

- Im Teams-Tab bekommt jedes Team eine Dateien-Ansicht (Dialog-Portal wie überall): Liste, Upload, Download, Löschen.
- Neuer Unterbereich in den Einstellungen bzw. neuer Tab **Dateien** für die globalen Downloads: Upload, Umbenennen des Anzeigenamens, Reihenfolge, Löschen.
- Einstellung **Maximale Dateigröße (MB)** pro Organisation; gilt für Team-Uploads und globale Uploads. Beliebige Dateitypen sind erlaubt.

## Im-/Export

Team-Dateien und globale Dateien werden in das ZIP aufgenommen (Metadaten in den JSON-Daten, die Dateien selbst in Unterordnern) und beim Import wieder angelegt — analog zu Hintergrundbildern und Slides, mit Replace/Append.

## Technische Umsetzung

- Migration:
  - `public.team_files` (tenant_id, team_id → teams ON DELETE CASCADE, name, path, content_type, size_bytes, sort_order, created_at/updated_at + touch-Trigger).
  - `public.tenant_files` (tenant_id, name, path, content_type, size_bytes, sort_order, …) für globale Downloads.
  - GRANTs für `service_role`, RLS aktiv, service-only Policy — genau wie bei `slides`/`teams`.
  - `tenants.max_upload_mb` (int, Default 10).
- Storage: neuer privater Bucket `tenant-files` (Pfade `<tenant_id>/team/<team_id>/…` und `<tenant_id>/global/…`), Bucket-Limit passend zum konfigurierten Maximum; RLS-Policies auf `storage.objects` service-role-only wie bei den bestehenden Buckets. Der Local-Backend-Treiber nutzt automatisch das Dateisystem.
- Server-Funktionen in `src/lib/board.functions.ts` (Admin, via `requireTenantAdmin`): `listTeamFiles`, `uploadTeamFile`, `deleteTeamFile`, `listTenantFiles`, `uploadTenantFile`, `renameTenantFile`, `deleteTenantFile` — Upload als Base64 wie `uploadSlide`, Größenprüfung gegen `max_upload_mb`.
- Server-Funktionen in `src/lib/registration.functions.ts` (Team, via `token` + `edit_code`): `listTeamFilesForTeam` (eigene + globale), `uploadTeamFileForTeam`, `deleteTeamFileForTeam`; Schreibzugriffe respektieren `team_edit_locked` und liefern nie Dateien anderer Teams.
- Download über eine neue öffentliche Route `src/routes/api/public/file.$kind.$id.ts`, die anhand eines kurzlebigen signierten Tokens (bzw. `token`+`code` für Teams) streamt und `Content-Disposition: attachment` mit dem Original-Namen setzt. Kein direkter Bucket-Zugriff vom Browser.
- UI: neues `TeamFilesPanel` und `TenantFilesPanel` in `src/components/admin/`, Einbindung in `TeamsPanel.tsx` und `src/routes/tenant/$tenantKey/index.tsx`; Team-Seite `src/routes/tr/$token.$code.tsx` erhält die beiden Bereiche.
- `src/lib/tenant-io.ts`: IO_VERSION erhöhen, Sektionen `team_files`/`tenant_files` in Schema, Export und Import (Dateien im ZIP unter `files/`), `max_upload_mb` in den Tenant-Feldern.
- i18n-Schlüssel für DE/EN ergänzen.
