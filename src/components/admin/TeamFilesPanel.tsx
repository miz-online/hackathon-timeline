import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { FileList } from "@/components/FileList";
import { useI18n } from "@/lib/i18n";
import {
  deleteTeamFile,
  getFileDownloadUrl,
  listTeamFiles,
  uploadTeamFile,
} from "@/lib/files.functions";

/** Files of a single team, managed by the organization. */
export function TeamFilesPanel({
  tenantKey,
  teamId,
  teamName,
  maxUploadMb,
}: {
  tenantKey: string;
  teamId: string;
  teamName: string;
  maxUploadMb: number;
}) {
  const { t } = useI18n();
  const listFn = useServerFn(listTeamFiles);
  const uploadFn = useServerFn(uploadTeamFile);
  const deleteFn = useServerFn(deleteTeamFile);
  const urlFn = useServerFn(getFileDownloadUrl);

  const q = useQuery({
    queryKey: ["team-files", tenantKey, teamId],
    queryFn: () => listFn({ data: { key: tenantKey, teamId } }),
  });

  return (
    <FileList
      title={t("files.teamTitle", { name: teamName })}
      items={q.data ?? []}
      maxUploadMb={maxUploadMb}
      canUpload
      canDelete
      onUpload={async (file) => {
        await uploadFn({ data: { key: tenantKey, teamId, ...file } });
        await q.refetch();
      }}
      onDelete={async (id) => {
        await deleteFn({ data: { key: tenantKey, id } });
        await q.refetch();
      }}
      onDownload={async (id) => {
        const r = await urlFn({ data: { key: tenantKey, scope: "team" as const, id } });
        return r.url;
      }}
    />
  );
}
