import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import logoAsset from "@/assets/pit-hackathon-logo.png.asset.json";
import { useI18n } from "@/lib/i18n";
import { derivePalette, DEFAULT_ACCENT } from "@/lib/colors";

type Slide = {
  id: string;
  name: string;
  url: string;
  content_type: string;
  duration_seconds?: number | null;
  kind?: "image" | "entries" | "teams";
};

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

const GLOW =
  "0 0 6px rgba(255,255,255,0.95), 0 0 18px rgba(255,255,255,0.85), 0 0 40px rgba(255,255,255,0.65)";

export function SlidesTemplate({
  tenantName,
  roomName,
  slides,
  slideSeconds,
  slideOverlay,
  logoUrl,
  logoHeight,
  accentColor,
  roomColor,
  overview = false,
  renderEntries,
}: {
  tenantName: string;
  roomName: string;
  slides: Slide[];
  slideSeconds: number;
  slideOverlay?: { show_room_name?: boolean; show_clock?: boolean; show_logo?: boolean } | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  accentColor?: string | null;
  roomColor?: string | null;
  overview?: boolean;
  renderEntries?: () => ReactNode;
}) {
  const { t } = useI18n();
  const palette = derivePalette(roomColor || accentColor || DEFAULT_ACCENT);
  const [now, setNow] = useState(() => Date.now());
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Stable signature: live updates deliver a new array every poll, which must
  // not restart the current slide's timer (otherwise long slides never advance).
  const signature = slides.map((s) => `${s.id}:${s.duration_seconds ?? ""}`).join("|");
  const count = slides.length;
  const currentSeconds = count
    ? (slides[index % count]?.duration_seconds ?? slideSeconds ?? 10)
    : 0;

  useEffect(() => {
    if (!count) {
      setIndex(0);
      return;
    }
    const ms = Math.max(1, currentSeconds) * 1000;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, currentSeconds, index, count]);

  const current = slides.length ? slides[index % slides.length] : null;
  const showEntries = current?.kind === "entries";
  const clock = `${pad(new Date(now).getHours())}:${pad(new Date(now).getMinutes())}`;

  return (
    <>
      <style>{`html, body { overflow: hidden !important; background: #000; }`}</style>
      <div
        style={{
          position: "relative",
          height: "100vh",
          width: "100vw",
          overflow: "hidden",
          backgroundColor: "#000",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <AnimatePresence initial={false}>
          {current && showEntries ? (
            <motion.div
              key={current.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#fff" }}
            >
              {renderEntries?.()}
            </motion.div>
          ) : current ? (
            <motion.img
              key={current.id}
              src={current.url}
              alt={current.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              key="empty"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#9ca3af",
                fontSize: 22,
              }}
            >
              {t("slides.displayEmpty")}
            </div>
          )}
        </AnimatePresence>

        {!showEntries && ((slideOverlay?.show_room_name ?? true) || (slideOverlay?.show_clock ?? true)) && (
          <header
            style={{
              position: "absolute",
              top: "clamp(12px, 1.8vw, 28px)",
              left: "clamp(12px, 1.8vw, 28px)",
              right: "clamp(12px, 1.8vw, 28px)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              color: "#111827",
              zIndex: 5,
              pointerEvents: "none",
            }}
          >
            {(slideOverlay?.show_room_name ?? true) && (
              <>
                <div
                  style={{
                    fontSize: "clamp(24px, 3vw, 38px)",
                    fontWeight: 700,
                    lineHeight: 1.1,
                    flex: 1,
                    minWidth: 0,
                    color: palette.base,
                    textShadow: GLOW,
                  }}
                >
                  {overview ? tenantName : roomName}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    textAlign: "center",
                    flexShrink: 0,
                    textShadow: GLOW,
                  }}
                >
                  {overview ? "" : tenantName}
                </div>
              </>
            )}
            {(slideOverlay?.show_clock ?? true) && (
              <div
                style={{
                  fontSize: "clamp(24px, 3vw, 38px)",
                  fontWeight: 700,
                  lineHeight: 1.1,
                  fontVariantNumeric: "tabular-nums",
                  flex: 1,
                  minWidth: 0,
                  textAlign: "right",
                  color: palette.base,
                  textShadow: GLOW,
                }}
              >
                {clock}
              </div>
            )}
          </header>
        )}

        {!showEntries && (slideOverlay?.show_logo ?? true) && (
          <footer
            style={{
              position: "absolute",
              right: "clamp(12px, 1.8vw, 28px)",
              bottom: "clamp(12px, 1.8vw, 28px)",
              zIndex: 6,
              pointerEvents: "none",
            }}
          >
            <img
              src={logoUrl || logoAsset.url}
              alt="Logo"
              style={{
                height: logoHeight ? `${logoHeight}px` : "clamp(42px, 5.4vw, 78px)",
                width: "auto",
                filter:
                  "drop-shadow(0 0 6px rgba(255,255,255,0.95)) drop-shadow(0 0 18px rgba(255,255,255,0.8)) drop-shadow(0 0 36px rgba(255,255,255,0.6))",
              }}
            />
          </footer>
        )}
      </div>
    </>
  );
}
