import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileArchive } from "lucide-react";
import { toast } from "sonner";

import { FileList } from "@/components/FileList";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  deleteTeamFile,
  getFileDownloadUrl,
  getTeamFilesZipUrl,
  listAllTeamFiles,
  renameTeamFile,
} from "@/lib/files.functions";

/** Flat list of every team file, for quick downloads and clean up. */
export function AllTeamFilesPanel({ tenantKey }: { tenantKey: string }) {
  const { t } = useI18n();
  const listFn = useServerFn(listAllTeamFiles);
  const deleteFn = useServerFn(deleteTeamFile);
  const renameFn = useServerFn(renameTeamFile);
  const urlFn = useServerFn(getFileDownloadUrl);
  const zipFn = useServerFn(getTeamFilesZipUrl);
  const [team, setTeam] = useState("");

  const q = useQuery({
    queryKey: ["all-team-files", tenantKey],
    queryFn: () => listFn({ data: { key: tenantKey } }),
  });
  const items = q.data ?? [];

  const teams = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of items) if (!seen.has(f.team_id)) seen.set(f.team_id, f.tag);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [items]);

  const zip = async (ids: string[]) => {
    try {
      const r = await zipFn({ data: { key: tenantKey, ids } });
      window.location.href = r.url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <FileList
      title={t("files.allTeams")}
      hint={t("files.allTeamsHint")}
      items={items}
      canDelete
      canRename
      filterable
      selectable={items.length > 0}
      headerExtra={
        items.length > 0 ? (
          <div className="flex items-center gap-2">
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">{t("files.zipTeamPick")}</option>
              {teams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!team}
              onClick={() =>
                void zip(items.filter((f) => f.team_id === team).map((f) => f.id))
              }
            >
              <FileArchive className="mr-2 h-4 w-4" />
              {t("files.zipTeam")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void zip([])}>
              <FileArchive className="mr-2 h-4 w-4" />
              {t("files.zipAll")}
            </Button>
          </div>
        ) : null
      }
      bulkActions={(ids) =>
        ids.length ? (
          <Button size="sm" onClick={() => void zip(ids)}>
            <FileArchive className="mr-2 h-4 w-4" />
            {t("files.zipSelected", { count: ids.length })}
          </Button>
        ) : null
      }
      onDelete={async (id) => {
        await deleteFn({ data: { key: tenantKey, id } });
        await q.refetch();
      }}
      onRename={async (id, name) => {
        await renameFn({ data: { key: tenantKey, id, name } });
        await q.refetch();
      }}
      onDownload={async (id) => {
        const r = await urlFn({ data: { key: tenantKey, scope: "team" as const, id } });
        return r.url;
      }}
    />
  );
}
