import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { TeamGridPrintSheet } from "@/components/admin/TeamGridPrintSheet";
import { Card } from "@/components/ui/card";
import { getTenant, listColorSchemes, listRooms, listTeams } from "@/lib/board.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/tenant/$tenantKey/team-grid-print")({
  head: () => ({
    meta: [
      { title: "16:9 team schedule — Room Board" },
      { name: "description", content: "A print-ready 16:9 team schedule in saved order." },
      { property: "og:title", content: "16:9 team schedule — Room Board" },
      { property: "og:description", content: "A print-ready 16:9 team schedule in saved order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamGridPrintPage,
});

function TeamGridPrintPage() {
  const { tenantKey } = Route.useParams();
  const { t } = useI18n();
  const getTenantFn = useServerFn(getTenant);
  const listTeamsFn = useServerFn(listTeams);
  const listRoomsFn = useServerFn(listRooms);
  const listSchemesFn = useServerFn(listColorSchemes);

  const tenantQ = useQuery({
    queryKey: ["tenant", tenantKey],
    queryFn: () => getTenantFn({ data: { key: tenantKey } }),
  });
  const teamsQ = useQuery({
    queryKey: ["teams", tenantKey],
    queryFn: () => listTeamsFn({ data: { key: tenantKey } }),
  });
  const roomsQ = useQuery({
    queryKey: ["rooms", tenantKey],
    queryFn: () => listRoomsFn({ data: { key: tenantKey } }),
  });
  const schemesQ = useQuery({
    queryKey: ["schemes", tenantKey],
    queryFn: () => listSchemesFn({ data: { key: tenantKey } }),
  });

  const error = tenantQ.error ?? teamsQ.error ?? roomsQ.error ?? schemesQ.error;
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md p-6 text-center text-sm text-muted-foreground">
          {(error as Error).message}
        </Card>
      </div>
    );
  }

  if (!tenantQ.data || !teamsQ.data || !roomsQ.data || !schemesQ.data) {
    return <div className="p-8 text-sm text-muted-foreground">{t("admin.loading")}</div>;
  }

  return (
    <TeamGridPrintSheet
      teams={teamsQ.data}
      rooms={roomsQ.data}
      schemes={schemesQ.data}
      defaultColor={tenantQ.data.accent_color}
    />
  );
}