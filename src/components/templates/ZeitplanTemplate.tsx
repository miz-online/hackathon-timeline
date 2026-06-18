import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import logoAsset from "@/assets/pit-hackathon-logo.png.asset.json";
import { useI18n } from "@/lib/i18n";

type Entry = { id: string; time: string; title: string; description: string; tags: string[] };

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ZeitplanTemplate({
  tenantName,
  roomName,
  entries,
}: {
  tenantName: string;
  roomName: string;
  entries: Entry[];
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = `${pad(new Date(now).getHours())}:${pad(new Date(now).getMinutes())}`;
  const RED = "#C0322B";

  return (
    <>
      <style>{`
        @keyframes zp-glow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(192,50,43,0.55), 0 0 12px 2px rgba(192,50,43,0.35) inset;
            border-color: #C0322B;
          }
          50% {
            box-shadow: 0 0 18px 6px rgba(192,50,43,0.75), 0 0 22px 4px rgba(255,90,80,0.55) inset;
            border-color: #ff5a50;
          }
        }
        @keyframes zp-glow-bg {
          0%, 100% { background-color: #C0322B; box-shadow: 0 0 0 0 rgba(192,50,43,0); }
          50% { background-color: #d94840; box-shadow: 0 0 18px 4px rgba(255,90,80,0.8); }
        }
        .zp-glow { animation: zp-glow 1.6s ease-in-out infinite; }
        .zp-glow-bg { animation: zp-glow-bg 1.6s ease-in-out infinite; }
      `}</style>
      <div
        style={{
          minHeight: "100vh",
          backgroundColor: "#ffffff",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: "#1f2937",
          padding: "clamp(12px, 1.8vw, 28px)",
          display: "flex",
          flexDirection: "column",
          gap: "clamp(14px, 1.8vw, 26px)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                color: "#6b7280",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {tenantName}
            </div>
            <div
              style={{
                fontSize: "clamp(24px, 3vw, 38px)",
                fontWeight: 700,
                color: "#111827",
              }}
            >
              {roomName}
            </div>
          </div>
          <div
            style={{
              fontSize: "clamp(24px, 2.6vw, 36px)",
              fontWeight: 600,
              color: RED,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {clock}
          </div>
        </header>

        <main
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "clamp(12px, 1.4vw, 20px)",
            flex: 1,
          }}
        >
          {entries.length === 0 ? (
            <div
              style={{
                color: "#9ca3af",
                fontSize: 20,
                textAlign: "center",
                padding: "72px 0",
              }}
            >
              {t("display.empty")}
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {entries.map((e) => {
                const entryMs = new Date(e.time).getTime();
                const diffMin = Math.round((entryMs - now) / 60000);
                const inGrace = entryMs <= now;
                const showRelative = !inGrace && diffMin < 15;

                return (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className={inGrace ? "zp-glow" : ""}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      border: `2px solid ${RED}`,
                      borderRadius: 9999,
                      overflow: "hidden",
                      background: "#fff",
                      minHeight: "clamp(56px, 6.2vw, 84px)",
                    }}
                  >
                    <div
                      className={inGrace ? "zp-glow-bg" : ""}
                      style={{
                        backgroundColor: RED,
                        color: "#fff",
                        fontWeight: 700,
                        padding: "0 clamp(16px, 2vw, 32px)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: "clamp(100px, 11vw, 160px)",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: 1.1,
                      }}
                    >
                      {showRelative ? (
                        <>
                          <div style={{ fontSize: "clamp(18px, 2vw, 26px)", fontWeight: 700 }}>
                            {t("display.inMinutes", { minutes: Math.max(0, diffMin) })}
                          </div>
                          <div
                            style={{
                              fontSize: "clamp(12px, 1.2vw, 16px)",
                              opacity: 0.7,
                              fontWeight: 500,
                              marginTop: 2,
                            }}
                          >
                            {formatTime(e.time)}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: "clamp(18px, 2.1vw, 28px)" }}>
                          {formatTime(e.time)}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        padding: "clamp(10px, 1.2vw, 18px) clamp(16px, 2vw, 32px)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "clamp(16px, 1.8vw, 25px)",
                          color: "#1f2937",
                          lineHeight: 1.2,
                        }}
                      >
                        {e.title}
                      </div>
                      {e.description ? (
                        <div
                          style={{
                            fontStyle: "italic",
                            color: "#6b7280",
                            fontSize: "clamp(13px, 1.15vw, 16px)",
                            lineHeight: 1.35,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {e.description}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </main>

        <footer style={{ display: "flex", justifyContent: "flex-start" }}>
          <img
            src={logoAsset.url}
            alt="PIT Hackathon"
            style={{ height: "clamp(42px, 5.4vw, 78px)", width: "auto" }}
          />
        </footer>
      </div>
    </>
  );
}
