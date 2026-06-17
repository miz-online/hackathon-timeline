import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRooms, getTenant } from "@/lib/board.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/tenant/$tenantKey/rooms")({
  component: RoomPicker,
});

function RoomPicker() {
  const { tenantKey } = Route.useParams();
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
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Rooms</div>
            <h1 className="text-xl font-semibold">{tenantQ.data?.name ?? "…"}</h1>
          </div>
          <Link to="/tenant/$tenantKey" params={{ tenantKey }}>
            <Button variant="outline" size="sm">
              Admin
            </Button>
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(roomsQ.data ?? []).map((r) => (
          <Link
            key={r.id}
            to="/tenant/$tenantKey/room/$roomId"
            params={{ tenantKey, roomId: r.id }}
          >
            <Card className="p-6 hover:bg-accent transition-colors h-full">
              <div className="font-semibold text-lg">{r.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                tag <span className="font-mono">{r.tag}</span>
              </div>
            </Card>
          </Link>
        ))}
        {roomsQ.data && roomsQ.data.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3 text-center">
            No rooms yet. Add some in the admin.
          </Card>
        ) : null}
      </main>
    </div>
  );
}
