import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import logoAsset from "@/assets/pit-hackathon-logo.png.asset.json";
import { useI18n } from "@/lib/i18n";
import { derivePalette, DEFAULT_ACCENT } from "@/lib/colors";

type Entry = {
  id: string;
  time: string;
  end_time?: string | null;
  title: string;
  description: string;
  tags: string[];
  color?: string | null;
  background_url?: string | null;
  background_align?: "right-top" | "right-bottom" | "right-stretch" | "fill" | "time" | null;
  background_height?: number | null;
  background_opacity?: number | null;
  background_margin?: number | null;
  background_tint?: "base" | "deep" | "peak" | "highlight" | "onBase" | null;
};

/**
 * Renders an entry image, optionally recolored with a palette color.
 * Tinting uses a CSS mask so the image's alpha channel keeps its shape.
 */
function EntryImage({
  src,
  tintColor,
  style,
  imgStyle,
}: {
  src: string;
  tintColor?: string | null;
  style: CSSProperties;
  imgStyle?: CSSProperties;
}) {
  if (!tintColor) {
    return <img src={src} alt="" aria-hidden style={{ ...style, ...imgStyle, pointerEvents: "none" }} />;
  }
  return (
    <span style={{ ...style, display: "inline-block", pointerEvents: "none" }}>
      <img src={src} alt="" aria-hidden style={{ ...imgStyle, display: "block", opacity: 0 }} />
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: tintColor,
          WebkitMaskImage: `url("${src}")`,
          maskImage: `url("${src}")`,
          WebkitMaskSize: style.objectFit === "cover" ? "cover" : "contain",
          maskSize: style.objectFit === "cover" ? "cover" : "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    </span>
  );
}


const ANIM_EPOCH = Date.now();

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
  logoUrl,
  logoHeight,
  accentColor,
  roomColor,
}: {
  tenantName: string;
  roomName: string;
  entries: Entry[];
  logoUrl?: string | null;
  logoHeight?: number | null;
  accentColor?: string | null;
  roomColor?: string | null;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = `${pad(new Date(now).getHours())}:${pad(new Date(now).getMinutes())}`;
  const defaultPalette = derivePalette(accentColor || DEFAULT_ACCENT);
  const headerPalette = derivePalette(roomColor || accentColor || DEFAULT_ACCENT);

  // shared animation timeline so every glowing entry animates in sync,
  // computed once per entry when it first mounts
  const delayCache = useRef(new Map<string, { border: string; bg: string }>());
  const getDelays = (id: string) => {
    const cache = delayCache.current;
    let d = cache.get(id);
    if (!d) {
      const elapsed = (Date.now() - ANIM_EPOCH) / 1000;
      d = { border: `-${elapsed % 4}s`, bg: `-${elapsed % 10}s` };
      cache.set(id, d);
    }
    return d;
  };

  return (
    <>
      <style>{`
        html, body { overflow: hidden !important; }
        @property --gradient-angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes zp-rotate-border {
          0% { --gradient-angle: 0deg; }
          100% { --gradient-angle: 360deg; }
        }
        @keyframes zp-glow-bg {
          0% {
            background-color: var(--zp-base);
            box-shadow: 0 0 0 0 var(--zp-glow-none);
          }
          50% {
            background-color: var(--zp-peak);
            box-shadow: 0 0 var(--zp-glow-blur) var(--zp-glow-spread) var(--zp-glow-strong);
          }
          100% {
            background-color: var(--zp-base);
            box-shadow: 0 0 0 0 var(--zp-glow-none);
          }
        }
        .zp-root {
          --title-size: clamp(16px, 1.8vw, 25px);
          --desc-size: clamp(13px, 1.15vw, 16px);
          --time-size: clamp(18px, 2.1vw, 28px);
          --entry-v-pad: clamp(10px, 1.2vw, 18px);
          --entry-gap: 4px;
          --list-gap: clamp(12px, 1.4vw, 20px);
          --entry-min-h: calc(2 * var(--entry-v-pad) + var(--entry-gap) + var(--title-size) * 1.2 + var(--desc-size) * 1.35);
          --entry-radius: calc((var(--entry-min-h) + 8px) / 2);
          --time-width: clamp(170px, 15vw, 220px);
          --time-pad-top: calc((var(--entry-min-h) - var(--time-size) * 1.1) / 2);
        }
        .zp-entry {
          min-height: var(--entry-min-h);
          border-radius: var(--entry-radius);
        }
        .zp-time {
          padding-top: var(--time-pad-top);
          padding-bottom: var(--time-pad-top);
        }
        .zp-glow {
          border: 4px solid transparent !important;
          background: linear-gradient(white, white) padding-box,
            conic-gradient(
              from var(--gradient-angle),
              var(--zp-base),
              var(--zp-glow-strong) 10%,
              var(--zp-glow-soft) 20%,
              white 25%,
              var(--zp-glow-soft) 27%,
              var(--zp-glow-strong) 29%,
              var(--zp-base) 30%
            ) border-box;
          border-radius: var(--entry-radius) !important;
          animation: zp-rotate-border var(--zp-border-duration) linear infinite;
        }
        .zp-glow-bg { animation: zp-glow-bg var(--zp-pulse-duration) ease-in-out infinite; }
      `}</style>
      <div
        className="zp-root"
        style={{
          height: "100vh",
          overflow: "hidden",
          position: "relative",
          backgroundColor: "#ffffff",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: "#1f2937",
          padding: "clamp(12px, 1.8vw, 28px) clamp(12px, 1.8vw, 28px) 0",
          display: "flex",
          flexDirection: "column",
          gap: "clamp(14px, 1.8vw, 26px)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: "clamp(24px, 3vw, 38px)",
              lineHeight: 1.1,
              fontWeight: 700,
              color: headerPalette.base,
              flex: 1,
              minWidth: 0,
            }}
          >
            {roomName}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#6b7280",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            {tenantName}
          </div>
          <div
            style={{
              fontSize: "clamp(24px, 3vw, 38px)",
              lineHeight: 1.1,
              fontWeight: 700,
              color: headerPalette.base,
              fontVariantNumeric: "tabular-nums",
              flex: 1,
              minWidth: 0,
              textAlign: "right",
            }}
          >
            {clock}
          </div>
        </header>


        <main
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--list-gap)",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            padding: "4px",
            margin: "-4px",
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
            <AnimatePresence initial={false} mode="popLayout">
              {entries.map((e) => {
                const entryMs = new Date(e.time).getTime();
                const endMs = e.end_time ? new Date(e.end_time).getTime() : null;
                const diffMin = Math.ceil((entryMs - now) / 60000);
                const inGrace = entryMs <= now && (endMs == null || endMs > now);
                const showRelative = !inGrace && diffMin < 15;
                const delays = getDelays(e.id);
                const p = e.color ? derivePalette(e.color) : defaultPalette;
                const vars = {
                  "--zp-base": p.base,
                  "--zp-peak": p.peak,
                  "--zp-glow-strong": p.glowStrong,
                  "--zp-glow-soft": p.glowSoft,
                  "--zp-glow-none": p.glowNone,
                  "--zp-glow-blur": p.glowBlur,
                  "--zp-glow-spread": p.glowSpread,
                  "--zp-border-duration": p.borderDuration,
                  "--zp-pulse-duration": p.pulseDuration,
                } as CSSProperties;
                const bg = e.background_url ?? null;
                const bgAlign = e.background_align ?? "right-top";
                const bgH = e.background_height ?? 80;
                const bgOpacity = (e.background_opacity ?? 100) / 100;
                const bgM = e.background_margin ?? 0;
                const bgTint = e.background_tint ? p[e.background_tint] : null;
                const bgStyle: CSSProperties | null = !bg
                  ? null
                  : bgAlign === "fill"
                    ? {
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }
                    : bgAlign === "right-stretch"
                      ? {
                          position: "absolute",
                          top: bgM,
                          bottom: bgM,
                          right: bgM,
                          height: `calc(100% - ${bgM * 2}px)`,
                          width: "auto",
                        }
                      : bgAlign === "right-bottom"
                        ? { position: "absolute", bottom: bgM, right: bgM, height: `${bgH}px`, width: "auto" }
                        : { position: "absolute", top: bgM, right: bgM, height: `${bgH}px`, width: "auto" };



                return (
                  <motion.div
                    key={e.id}
                    layout
                    initial={{ opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16, transition: { duration: 0.6, ease: "easeInOut" } }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className={`zp-entry ${inGrace ? "zp-glow" : ""}`}
                    style={{
                      ...vars,
                      display: "flex",
                      alignItems: "stretch",
                      flexShrink: 0,
                      border: inGrace ? "4px solid transparent" : `2px solid ${p.base}`,
                      overflow: "hidden",
                      background: inGrace ? undefined : "#fff",
                      animationDelay: inGrace ? delays.border : undefined,
                    }}
                  >
                    <div
                      className={`zp-time ${inGrace ? "zp-glow-bg" : ""}`}
                      style={{
                        backgroundColor: p.base,
                        color: p.onBase,
                        fontWeight: 700,
                        paddingLeft: "clamp(16px, 2vw, 32px)",
                        paddingRight: "clamp(16px, 2vw, 32px)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        width: "var(--time-width)",
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: 1.1,
                        animationDelay: inGrace ? delays.bg : undefined,
                      }}
                    >
                      {inGrace ? (
                        <>
                          <div style={{ fontSize: "var(--time-size)", whiteSpace: "nowrap" }}>{t("display.now")}</div>
                          {endMs != null ? (
                          <div
                            style={{
                              fontSize: "clamp(12px, 1.2vw, 16px)",
                              opacity: 0.7,
                              fontWeight: 500,
                              marginTop: 2,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t("display.untilTime", { time: formatTime(e.end_time!) })}
                          </div>
                          ) : null}
                        </>
                      ) : showRelative ? (
                        <>
                          <div style={{ fontSize: "clamp(18px, 2vw, 26px)", fontWeight: 700, whiteSpace: "nowrap" }}>
                            {t("display.inMinutes", { minutes: Math.max(1, diffMin) })}
                          </div>

                          <div
                            style={{
                              fontSize: "clamp(12px, 1.2vw, 16px)",
                              opacity: 0.7,
                              fontWeight: 500,
                              marginTop: 2,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {endMs != null
                              ? `${formatTime(e.time)} - ${formatTime(e.end_time!)}`
                              : formatTime(e.time)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: "clamp(18px, 2.1vw, 28px)", whiteSpace: "nowrap" }}>
                            {formatTime(e.time)}
                          </div>
                          {endMs != null ? (
                            <div
                              style={{
                                fontSize: "clamp(12px, 1.2vw, 16px)",
                                opacity: 0.7,
                                fontWeight: 500,
                                marginTop: 2,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {t("display.untilTime", { time: formatTime(e.end_time!) })}
                            </div>
                          ) : null}
                        </>
                      )}
                      {bg && bgAlign === "time" ? (
                        <EntryImage
                          src={bg}
                          tintColor={bgTint}
                          style={{
                            position: "relative",
                            width: `calc(100% - ${bgM * 2}px)`,
                            marginTop: 8 + bgM,
                            marginBottom: bgM,
                            opacity: bgOpacity,
                          }}
                          imgStyle={{ width: "100%", height: "auto", objectFit: "contain" }}
                        />
                      ) : null}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        position: "relative",
                        overflow: "hidden",
                        padding: "clamp(10px, 1.2vw, 18px) clamp(16px, 2vw, 32px)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      {bg && bgAlign !== "time" && bgStyle ? (
                        <EntryImage
                          src={bg}
                          tintColor={bgTint}
                          style={{ ...bgStyle, opacity: bgOpacity }}
                          imgStyle={{
                            width: bgStyle.width === "100%" ? "100%" : "auto",
                            height: "100%",
                            objectFit: bgAlign === "fill" ? "cover" : "contain",
                          }}
                        />
                      ) : null}

                      <div
                        style={{
                          position: "relative",
                          zIndex: 1,
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
                            position: "relative",
                            zIndex: 1,
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

        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "var(--list-gap)",
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 55%, #ffffff 100%)",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />

        <footer
          style={{
            position: "absolute",
            right: "clamp(12px, 1.8vw, 28px)",
            bottom: "clamp(12px, 1.8vw, 28px)",
            display: "flex",
            justifyContent: "flex-end",
            pointerEvents: "none",
            zIndex: 6,
          }}
        >
          <img
            src={logoUrl || logoAsset.url}
            alt="PIT Hackathon"
            style={{
              height: logoHeight ? `${logoHeight}px` : "clamp(42px, 5.4vw, 78px)",
              width: "auto",
            }}
          />
        </footer>
      </div>
    </>
  );
}
