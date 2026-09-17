import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { FileList } from "@/components/FileList";
import { useI18n } from "@/lib/i18n";
import {
  deleteTenantFile,
  getFileDownloadUrl,
  listTenantFiles,
  renameTenantFile,
  uploadTenantFile,
} from "@/lib/files.functions";

/** Organization wide downloads, offered read only to every team. */
export function TenantFilesPanel({
  tenantKey,
  maxUploadMb,
  disabled,
}: {
  tenantKey: string;
  maxUploadMb: number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const listFn = useServerFn(listTenantFiles);
  const uploadFn = useServerFn(uploadTenantFile);
  const deleteFn = useServerFn(deleteTenantFile);
  const renameFn = useServerFn(renameTenantFile);
  const urlFn = useServerFn(getFileDownloadUrl);

  const q = useQuery({
    queryKey: ["tenant-files", tenantKey],
    queryFn: () => listFn({ data: { key: tenantKey } }),
  });

  return (
    <FileList
      title={t("files.title")}
      hint={t("files.hint")}
      items={q.data ?? []}
      maxUploadMb={maxUploadMb}
      canUpload={!disabled}
      canDelete={!disabled}
      canRename={!disabled}
      lockedNote={disabled ? t("files.locked") : undefined}
      onUpload={async (file) => {
        await uploadFn({ data: { key: tenantKey, ...file } });
        await q.refetch();
      }}
      onDelete={async (id) => {
        await deleteFn({ data: { key: tenantKey, id } });
        await q.refetch();
      }}
      onRename={async (id, name) => {
        await renameFn({ data: { key: tenantKey, id, name } });
        await q.refetch();
      }}
      onDownload={async (id) => {
        const r = await urlFn({ data: { key: tenantKey, scope: "tenant" as const, id } });
        return r.url;
      }}
    />
  );
}
