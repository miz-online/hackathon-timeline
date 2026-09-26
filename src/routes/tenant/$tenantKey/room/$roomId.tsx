import { TeamGrid } from "@/components/admin/TeamGridPrintSheet";
import { DEFAULT_ACCENT } from "@/lib/colors";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ZeitplanTemplate } from "@/components/templates/ZeitplanTemplate";
import { SlidesTemplate } from "@/components/templates/SlidesTemplate";
import type { RoomSnapshot } from "@/lib/board.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/tenant/$tenantKey/room/$roomId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Live schedule — Room Board" },
      { name: "description", content: "Live time entries and slides for a room display." },
      { property: "og:title", content: "Live schedule — Room Board" },
      { property: "og:description", content: "Live time entries and slides for a room display." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RoomDisplay,
});

type Entry = RoomSnapshot["entries"][number];

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

  // Admins can force every display to reload its page (e.g. after an app
  // update): the snapshot carries a counter, a change means "reload once".
  const reloadCounter = useRef<number | null>(null);
  useEffect(() => {
    const rc = snapshot?.tenant.reload_counter;
    if (rc == null) return;
    if (reloadCounter.current === null) {
      reloadCounter.current = rc;
      return;
    }
    if (rc !== reloadCounter.current) window.location.reload();
  }, [snapshot]);

  // Slideshow entries switch the display at an exact time: reload right then
  // instead of waiting for the next poll.
  const switchAt = snapshot?.switch_at ?? null;
  useEffect(() => {
    if (!switchAt) return;
    const delay = new Date(switchAt).getTime() - Date.now() + 1000;
    if (!Number.isFinite(delay)) return;
    const id = setTimeout(
      () => {
        void fetch(`/api/public/snapshot/${tenantKey}/${roomId}?ts=${Date.now()}`, {
          cache: "no-store",
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (json) setSnapshot(json as RoomSnapshot);
          })
          .catch(() => {});
      },
      Math.max(500, delay),
    );
    return () => clearTimeout(id);
  }, [switchAt, tenantKey, roomId]);


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
        {failed
          ? "Room not found for this tenant key"
          : status === "reconnecting"
            ? t("display.reconnecting")
            : t("display.connecting")}

      </div>
    );
  }

  const now = Date.now();
  const cutoff = now - snapshot.tenant.past_grace_minutes * 60 * 1000;
  const todayKey = new Date().toDateString();
  const visible: Entry[] = snapshot.entries
    // Only today's entries belong on the room timeline.
    .filter((e) => new Date(e.time).toDateString() === todayKey)
    .filter((e) =>
      e.end_time
        ? new Date(e.end_time).getTime() >= now
        : new Date(e.time).getTime() >= cutoff,
    );

  const isOverview = snapshot.room.is_overview === true;
  const displayRoomName = isOverview ? t("rooms.overview") : snapshot.room.name;
  const activeTemplate = snapshot.room.template || snapshot.tenant.template;
  const isSlides = activeTemplate === "slides" || activeTemplate?.startsWith("slides:");
  // Key changes whenever the shown template (or slide set) changes, so the
  // crossfade below runs on manual and automatic switches alike.
  const templateKey = isSlides ? `slides:${activeTemplate}` : "zeitplan";

  const renderEntries = () => (
    <ZeitplanTemplate
      tenantName={snapshot.tenant.name}
      roomName={displayRoomName}
      overview={isOverview}
      logoUrl={snapshot.tenant.logo_url ? `/api/public/logo/${tenantKey}` : null}
      logoHeight={snapshot.tenant.logo_height}
      accentColor={snapshot.tenant.accent_color}
      roomColor={snapshot.room.color}
      focusMode={snapshot.tenant.focus_mode}
      focusCount={snapshot.tenant.focus_count}
      focusMinutes={snapshot.tenant.focus_minutes}
      focusDimOpacity={snapshot.tenant.focus_dim_opacity}
      entries={visible}
    />
  );

  const renderTeams = () => (
    <div className="h-full w-full bg-background p-[clamp(0.75rem,2vw,2rem)] text-foreground">
      <TeamGrid
        teams={(snapshot.teams ?? []).map((tm) => ({
          id: tm.id,
          name: tm.name,
          color: tm.color ?? snapshot.tenant.accent_color ?? DEFAULT_ACCENT,
        }))}
      />
    </div>
  );

  return (
    <div style={{ position: "relative", minHeight: "100vh", width: "100%" }}>
      <AnimatePresence initial={false} mode="sync">
        <motion.div
          key={templateKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
          style={{ position: "absolute", inset: 0, minHeight: "100vh" }}
        >
          {isSlides ? (
            <SlidesTemplate
              tenantName={snapshot.tenant.name}
              roomName={displayRoomName}
              overview={isOverview}
              slides={snapshot.slides ?? []}
              slideSeconds={snapshot.tenant.slide_seconds ?? 10}
              slideOverlay={snapshot.slide_overlay ?? null}
              logoUrl={snapshot.tenant.logo_url ? `/api/public/logo/${tenantKey}` : null}
              logoHeight={snapshot.tenant.logo_height}
              accentColor={snapshot.tenant.accent_color}
              roomColor={snapshot.room.color}
              renderEntries={renderEntries}
              renderTeams={renderTeams}
            />
          ) : (
            renderEntries()
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
