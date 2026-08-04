import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import { useI18n } from "@/lib/i18n";
import { exportTenantData, importTenantData } from "@/lib/board.functions";
import {
  DATA_FILENAME,
  SCHEMA_FILENAME,
  SECTIONS,
  TENANT_JSON_SCHEMA,
  VSCODE_SETTINGS,
  tenantDataSchema,
  type Section,
  type TenantData,
} from "@/lib/tenant-io";

void _t;

type LoadedFile = { path: string; content_type: string; dataBase64: string };

function base64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function bytesFromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function guessType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "avif") return "image/avif";
  return "image/png";
}

export function ImportExportPanel({
  tenantKey,
  onChange,
}: {
  tenantKey: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const exportFn = useServerFn(exportTenantData);
  const importFn = useServerFn(importTenantData);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<TenantData | null>(null);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [selected, setSelected] = useState<Section[]>([]);

  const available = parsed
    ? SECTIONS.filter((s) => parsed[s] !== undefined && parsed[s] !== null)
    : [];

  const doExport = async () => {
    setBusy(true);
    try {
      const res = await exportFn({ data: { key: tenantKey } });
      const zipFiles: Record<string, Uint8Array> = {
        [DATA_FILENAME]: strToU8(JSON.stringify(res.data, null, 2)),
        [SCHEMA_FILENAME]: strToU8(JSON.stringify(TENANT_JSON_SCHEMA, null, 2)),
        ".vscode/settings.json": strToU8(JSON.stringify(VSCODE_SETTINGS, null, 2)),
      };
      for (const f of res.files) zipFiles[f.path] = bytesFromBase64(f.dataBase64);
      const zipped = zipSync(zipFiles, { level: 6 });
      const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tenant-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file: File) => {
    try {
      let data: unknown;
      const loaded: LoadedFile[] = [];
      if (file.name.toLowerCase().endsWith(".zip")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(bytes);
        const dataKey =
          Object.keys(entries).find((k) => k.endsWith(DATA_FILENAME)) ??
          Object.keys(entries).find(
            (k) => k.endsWith(".json") && !k.includes("schema") && !k.includes(".vscode"),
          );
        if (!dataKey) throw new Error(t("io.noData"));
        data = JSON.parse(strFromU8(entries[dataKey]));
        for (const [path, content] of Object.entries(entries)) {
          if (path.endsWith("/") || path.endsWith(".json") || content.length === 0) continue;
          loaded.push({
            path,
            content_type: guessType(path),
            dataBase64: base64FromBytes(content),
          });
        }
      } else {
        data = JSON.parse(await file.text());
      }
      const result = tenantDataSchema.safeParse(data);
      if (!result.success) {
        toast.error(`${t("io.invalid")}: ${result.error.issues[0]?.message ?? ""}`);
        return;
      }
      setParsed(result.data);
      setFiles(loaded);
      setFileName(file.name);
      setSelected(
        SECTIONS.filter((s) => result.data[s] !== undefined && result.data[s] !== null),
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doImport = async () => {
    if (!parsed || selected.length === 0) return;
    if (mode === "replace" && !confirm(t("io.confirmReplace"))) return;
    setBusy(true);
    try {
      const payload: TenantData = { version: parsed.version };
      for (const s of selected) (payload as Record<string, unknown>)[s] = parsed[s];
      const res = await importFn({
        data: {
          key: tenantKey,
          mode,
          sections: selected,
          data: payload,
          files: files.filter((f) => f.path.startsWith("images/")),
        },
      });
      const summary = Object.entries(res.counts)
        .map(([k, v]) => `${t(`io.section.${k}`)}: ${v}`)
        .join(", ");
      toast.success(summary ? `${t("io.imported")} — ${summary}` : t("io.imported"));
      setParsed(null);
      setFiles([]);
      setFileName(null);
      setSelected([]);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-4 space-y-3">
        <div className="font-medium">{t("io.exportTitle")}</div>
        <p className="text-xs text-muted-foreground">{t("io.exportHint")}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={doExport}>
          {t("io.export")}
        </Button>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <div className="font-medium">{t("io.importTitle")}</div>
          <p className="text-xs text-muted-foreground">{t("io.importHint")}</p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip,application/json,.json"
          className="hidden"
          onChange={async (ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = "";
            if (f) await loadFile(f);
          }}
        />

        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            {t("io.chooseFile")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {fileName ?? t("io.noFileSelected")}
          </span>
        </div>

        {parsed ? (
          <>
            <div className="space-y-2">
              <Label>{t("io.mode")}</Label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "replace" | "append")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="replace">{t("io.mode.replace")}</option>
                <option value="append">{t("io.mode.append")}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {mode === "replace" ? t("io.mode.replaceHint") : t("io.mode.appendHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{t("io.sections")}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {available.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(s)}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                        )
                      }
                    />
                    <span>{t(`io.section.${s}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {Array.isArray(parsed[s]) ? `(${(parsed[s] as unknown[]).length})` : ""}
                    </span>
                  </label>
                ))}
              </div>
              {available.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("io.noSections")}</p>
              ) : null}
            </div>

            <Button disabled={busy || selected.length === 0} onClick={doImport}>
              {busy ? t("io.importing") : t("io.start")}
            </Button>
          </>
        ) : null}
      </Card>
    </div>
  );
}
