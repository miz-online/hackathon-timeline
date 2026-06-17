import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ZeitplanTemplate } from "@/components/templates/ZeitplanTemplate";
import type { RoomSnapshot } from "@/lib/board.functions";

export const Route = createFileRoute("/tenant/$tenantKey/room/$roomId")({
  ssr: false,
  component: RoomDisplay,
});

type Entry = { id: string; time: string; description: string; tags: string[] };

function RoomDisplay() {
  const { tenantKey, roomId } = Route.useParams();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const reconnectAttempts = useRef(0);

  // SSE connection with exponential-backoff reconnect
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus(reconnectAttempts.current === 0 ? "connecting" : "reconnecting");
      es = new EventSource(`/api/public/stream/${tenantKey}/${roomId}`);

      es.addEventListener("snapshot", (e) => {
        setSnapshot(JSON.parse((e as MessageEvent).data));
        setStatus("live");
        reconnectAttempts.current = 0;
      });
      es.addEventListener("update", (e) => {
        setSnapshot(JSON.parse((e as MessageEvent).data));
      });
      es.onerror = () => {
        if (es) {
          es.close();
          es = null;
        }
        if (cancelled) return;
        reconnectAttempts.current += 1;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(reconnectAttempts.current, 5));
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [tenantKey, roomId]);

  // Local re-filter every 1s so past entries disappear without a server push
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!snapshot) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#6b7280",
        }}
      >
        {status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
      </div>
    );
  }

  const cutoff = Date.now() - snapshot.tenant.past_grace_minutes * 60 * 1000;
  const visible: Entry[] = snapshot.entries.filter((e) => new Date(e.time).getTime() >= cutoff);

  return (
    <ZeitplanTemplate
      tenantName={snapshot.tenant.name}
      roomName={snapshot.room.name}
      entries={visible}
    />
  );
}
