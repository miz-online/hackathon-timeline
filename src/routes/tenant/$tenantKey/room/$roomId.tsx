import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ZeitplanTemplate } from "@/components/templates/ZeitplanTemplate";
import type { RoomSnapshot } from "@/lib/board.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/tenant/$tenantKey/room/$roomId")({
  ssr: false,
  component: RoomDisplay,
});

type Entry = { id: string; time: string; title: string; description: string; tags: string[] };

function RoomDisplay() {
  const { tenantKey, roomId } = Route.useParams();
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [failed, setFailed] = useState(false);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const loadSnapshot = async () => {
      try {
        const res = await fetch(
          `/api/public/snapshot/${tenantKey}/${roomId}?ts=${Date.now()}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (res.status === 404) setFailed(true);
          return false;
        }
        const json = (await res.json()) as RoomSnapshot;
        if (cancelled) return false;
        setSnapshot(json);
        setFailed(false);
        return true;
      } catch {
        return false;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      reconnectAttempts.current += 1;
      setStatus("reconnecting");
      const delay = Math.min(15_000, 1000 * 2 ** Math.min(reconnectAttempts.current, 4));
      reconnectTimer = setTimeout(connect, delay);
    };

    const dropStream = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      if (es) {
        es.close();
        es = null;
      }
    };

    function connect() {
      if (cancelled) return;
      setStatus(reconnectAttempts.current === 0 ? "connecting" : "reconnecting");
      void loadSnapshot();
      try {
        es = new EventSource(`/api/public/stream/${tenantKey}/${roomId}`);
      } catch {
        scheduleReconnect();
        return;
      }

      // If the stream never delivers a snapshot, treat it as dead and retry.
      watchdog = setTimeout(() => {
        dropStream();
        scheduleReconnect();
      }, 15_000);

      const onData = (e: Event) => {
        if (watchdog) {
          clearTimeout(watchdog);
          watchdog = null;
        }
        try {
          setSnapshot(JSON.parse((e as MessageEvent).data));
          setFailed(false);
        } catch {
          /* ignore malformed frame */
        }
        setStatus("live");
        reconnectAttempts.current = 0;
      };

      es.addEventListener("snapshot", onData);
      es.addEventListener("update", onData);
      es.onerror = () => {
        dropStream();
        if (cancelled) return;
        scheduleReconnect();
      };
    }

    connect();

    // Fallback polling: always keeps the screen fresh even if SSE is blocked.
    const poll = setInterval(() => {
      void loadSnapshot();
    }, 20_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void loadSnapshot();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      dropStream();
    };
  }, [tenantKey, roomId]);

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
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
        {status === "reconnecting" ? t("display.reconnecting") : t("display.connecting")}
      </div>
    );
  }

  const cutoff = Date.now() - snapshot.tenant.past_grace_minutes * 60 * 1000;
  const visible: Entry[] = snapshot.entries.filter(
    (e) => new Date(e.time).getTime() >= cutoff,
  );

  return (
    <ZeitplanTemplate
      tenantName={snapshot.tenant.name}
      roomName={snapshot.room.name}
      entries={visible}
    />
  );
}
