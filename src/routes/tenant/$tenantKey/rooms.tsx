import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRooms, getTenant } from "@/lib/board.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export const Route = createFileRoute("/tenant/$tenantKey/rooms")({
  component: RoomPicker,
});

function RoomPicker() {
  const { tenantKey } = Route.useParams();
  const { t } = useI18n();
  const getTenantFn = useServerFn(getTenant);
  const listRoomsFn = useServerFn(listRooms);

  const tenantQ = useQuery({
    queryKey: ["tenant", tenantKey],
    queryFn: () => getTenantFn({ data: { key: tenantKey } }),
  });
  const roomsQ = useQuery({
    queryKey: ["rooms", tenantKey],
    queryFn: () => listRoomsFn({ data: { key: tenantKey } }),
    enabled: !!tenantQ.data,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("nav.rooms")}
            </div>
            <h1 className="text-xl font-semibold">{tenantQ.data?.name ?? "…"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/tenant/$tenantKey" params={{ tenantKey }}>
              <Button variant="outline" size="sm">
                {t("nav.admin")}
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/tenant/$tenantKey/room/$roomId" params={{ tenantKey, roomId: "overview" }}>
          <Card className="p-6 hover:bg-accent transition-colors h-full">
            <div className="font-semibold text-lg">{t("rooms.overview")}</div>
            <div className="text-xs text-muted-foreground mt-1">{t("rooms.overviewHint")}</div>
          </Card>
        </Link>
        {(roomsQ.data ?? []).map((r) => (
          <Link
            key={r.id}
            to="/tenant/$tenantKey/room/$roomId"
            params={{ tenantKey, roomId: r.id }}
          >
            <Card className="p-6 hover:bg-accent transition-colors h-full">
              <div className="font-semibold text-lg">{r.name}</div>
            </Card>
          </Link>
        ))}
        {roomsQ.data && roomsQ.data.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3 text-center">
            {t("rooms.picker.empty")}
          </Card>
        ) : null}
      </main>
    </div>
  );
}
