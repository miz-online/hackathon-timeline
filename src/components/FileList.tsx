import { useRef, useState } from "react";
import { Download, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { formatBytes, type FileItem } from "@/lib/files";

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
  lockedNote,
  onUpload,
  onDownload,
  onDelete,
  onRename,
}: {
  title: string;
  hint?: string;
  items: FileItem[];
  maxUploadMb?: number;
  canUpload?: boolean;
  canDelete?: boolean;
  canRename?: boolean;
  lockedNote?: string;
  onUpload?: (file: { filename: string; contentType: string; dataBase64: string }) => Promise<void>;
  onDownload: (id: string) => Promise<string>;
  onDelete?: (id: string) => Promise<void>;
  onRename?: (id: string, name: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

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
        {canUpload && onUpload ? (
          <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? t("files.uploading") : t("files.upload")}
          </Button>
        ) : null}
      </div>

      {canUpload && maxUploadMb ? (
        <p className="text-xs text-muted-foreground">{t("files.maxHint", { mb: maxUploadMb })}</p>
      ) : null}
      {lockedNote ? <p className="text-xs text-muted-foreground">{lockedNote}</p> : null}

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

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t("files.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                {renaming === f.id ? (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="h-8"
                    />
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await onRename?.(f.id, draftName);
                          toast.success(t("files.renamed"));
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setRenaming(null);
                        }
                      }}
                    >
                      {t("files.rename")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="truncate text-sm">{f.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatBytes(f.size_bytes)} · {new Date(f.created_at).toLocaleString()}
                    </div>
                  </>
                )}
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
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenaming(f.id);
                      setDraftName(f.name);
                    }}
                  >
                    {t("files.rename")}
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
