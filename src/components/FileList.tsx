import { useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { formatBytes, type FileItem } from "@/lib/files";

/** A file row, optionally carrying a tag (e.g. the owning team name). */
export type ListedFile = FileItem & { tag?: string };

/** Reads a file as base64 without loading it as a huge string per byte. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function FileList({
  title,
  hint,
  items,
  maxUploadMb,
  canUpload = false,
  canDelete = false,
  canRename = false,
  filterable = false,
  selectable = false,
  headerExtra,
  bulkActions,
  lockedNote,
  onUpload,
  onDownload,
  onDelete,
  onRename,
}: {
  title: string;
  hint?: string;
  items: ListedFile[];
  maxUploadMb?: number;
  canUpload?: boolean;
  canDelete?: boolean;
  canRename?: boolean;
  filterable?: boolean;
  selectable?: boolean;
  headerExtra?: ReactNode;
  bulkActions?: (ids: string[], clear: () => void) => ReactNode;
  lockedNote?: string;
  onUpload?: (file: { filename: string; contentType: string; dataBase64: string }) => Promise<void>;
  onDownload: (id: string) => Promise<string>;
  onDelete?: (id: string) => Promise<void>;
  onRename?: (id: string, name: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ListedFile | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (f) =>
        f.name.toLowerCase().includes(needle) || (f.tag ?? "").toLowerCase().includes(needle),
    );
  }, [items, filter]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const download = async (id: string) => {
    try {
      const url = await onDownload(id);
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          {selectable && bulkActions ? bulkActions(selected, () => setSelected([])) : null}
          {canUpload && onUpload ? (
            <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              {busy ? t("files.uploading") : t("files.upload")}
            </Button>
          ) : null}
        </div>
      </div>

      {canUpload && maxUploadMb ? (
        <p className="text-xs text-muted-foreground">{t("files.maxHint", { mb: maxUploadMb })}</p>
      ) : null}
      {lockedNote ? <p className="text-xs text-muted-foreground">{lockedNote}</p> : null}

      {filterable && items.length > 0 ? (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("files.filter")}
          className="h-8 max-w-sm"
        />
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (ev) => {
          const files = Array.from(ev.target.files ?? []);
          ev.target.value = "";
          if (!files.length || !onUpload) return;
          setBusy(true);
          try {
            for (const file of files) {
              if (maxUploadMb && file.size > maxUploadMb * 1024 * 1024) {
                toast.error(t("files.tooLarge", { mb: maxUploadMb }));
                continue;
              }
              await onUpload({
                filename: file.name,
                contentType: file.type || "application/octet-stream",
                dataBase64: await toBase64(file),
              });
            }
            toast.success(t("files.uploaded"));
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("files.edit")}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>{t("files.name")}</Label>
                <Input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatBytes(editing.size_bytes)} · {editing.content_type} ·{" "}
                {new Date(editing.created_at).toLocaleString()}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  {t("files.cancel")}
                </Button>
                <Button
                  disabled={savingName || !draftName.trim()}
                  onClick={async () => {
                    setSavingName(true);
                    try {
                      await onRename?.(editing.id, draftName.trim());
                      toast.success(t("files.renamed"));
                      setEditing(null);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setSavingName(false);
                    }
                  }}
                >
                  {t("files.save")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("files.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              {selectable ? (
                <Checkbox
                  checked={selected.includes(f.id)}
                  onCheckedChange={() => toggle(f.id)}
                  aria-label={f.name}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm">{f.name}</span>
                  {f.tag ? (
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {f.tag}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("files.download")}
                  onClick={() => void download(f.id)}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canRename && onRename ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("files.edit")}
                    onClick={() => {
                      setEditing(f);
                      setDraftName(f.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
                {canDelete && onDelete ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("files.delete")}
                    onClick={async () => {
                      if (!confirm(t("files.confirmDelete"))) return;
                      try {
                        await onDelete(f.id);
                        setSelected((s) => s.filter((x) => x !== f.id));
                        toast.success(t("files.deleted"));
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
