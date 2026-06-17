import { useEffect, useState } from "react";

type Entry = { id: string; time: string; description: string; tags: string[] };

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseTitle(description: string): { title: string; detail?: string } {
  // Support "Title\nDetail" or "Title | Detail" or just title
  const nl = description.indexOf("\n");
  if (nl > -1) {
    return { title: description.slice(0, nl).trim(), detail: description.slice(nl + 1).trim() };
  }
  return { title: description };
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
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const RED = "#C0322B";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#ffffff",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: "#1f2937",
        padding: "clamp(24px, 4vw, 64px)",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(20px, 2.5vw, 36px)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 24,
          paddingBottom: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 14, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {tenantName}
          </div>
          <div style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 700, color: "#111827" }}>
            {roomName}
          </div>
        </div>
        <div
          style={{
            fontSize: "clamp(28px, 3vw, 40px)",
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
          gap: "clamp(16px, 1.8vw, 24px)",
          flex: 1,
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              color: "#9ca3af",
              fontSize: 22,
              textAlign: "center",
              padding: "80px 0",
            }}
          >
            Keine Einträge
          </div>
        ) : (
          entries.map((e) => {
            const { title, detail } = parseTitle(e.description);
            return (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  border: `2px solid ${RED}`,
                  borderRadius: 9999,
                  overflow: "hidden",
                  background: "#fff",
                  minHeight: "clamp(64px, 7vw, 96px)",
                }}
              >
                <div
                  style={{
                    backgroundColor: RED,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "clamp(20px, 2.4vw, 32px)",
                    padding: "0 clamp(20px, 2.2vw, 36px)",
                    display: "flex",
                    alignItems: "center",
                    minWidth: "clamp(110px, 12vw, 180px)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTime(e.time)}
                </div>
                <div
                  style={{
                    flex: 1,
                    padding: "clamp(12px, 1.4vw, 20px) clamp(20px, 2.2vw, 36px)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "clamp(18px, 2vw, 28px)",
                      color: "#1f2937",
                      lineHeight: 1.2,
                    }}
                  >
                    {title}
                  </div>
                  {detail ? (
                    <div
                      style={{
                        fontStyle: "italic",
                        color: "#6b7280",
                        fontSize: "clamp(14px, 1.3vw, 18px)",
                        lineHeight: 1.35,
                      }}
                    >
                      {detail}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
