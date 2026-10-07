import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

type Resp = { data: unknown; error: unknown };
function chain(resp: Resp) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) obj[m] = () => obj;
  obj.maybeSingle = () => Promise.resolve(resp);
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resp).then(res as never, rej as never);
  return obj;
}

const tenantRow = {
  id: "t1",
  name: "Acme",
  past_grace_minutes: 15,
  template: "zeitplan",
  logo_url: null,
  logo_height: 78,
  accent_color: "#000",
  slide_seconds: 10,
  focus_mode: "count",
  focus_count: 3,
  focus_minutes: 30,
  focus_dim_opacity: 35,
  practice_minutes: 10,
  practice_room_scope: "all",
};

function makeAdmin(opts: {
  tenant?: unknown;
  room?: unknown;
  entries?: unknown[];
  schemes?: unknown[];
  teams?: unknown[];
  rooms?: unknown[];
}) {
  let roomCall = 0;
  return {
    from: (table: string) => {
      switch (table) {
        case "tenants":
          return chain({ data: opts.tenant ?? null, error: null });
        case "rooms":
          roomCall++;
          if (roomCall === 1) return chain({ data: "room" in opts ? opts.room : null, error: null });
          return chain({ data: opts.rooms ?? [], error: null });
        case "entries":
          return chain({ data: opts.entries ?? [], error: null });
        case "color_schemes":
          return chain({ data: opts.schemes ?? [], error: null });
        case "teams":
          return chain({ data: opts.teams ?? [], error: null });
        default:
          return chain({ data: null, error: null });
      }
    },
  };
}

let admin: ReturnType<typeof makeAdmin>;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => admin }));

import { Route } from "@/routes/api/public/snapshot.$tenantKey.$roomId";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;
const req = () => new Request("http://x/api/public/snapshot/acme/r1");

describe("snapshot route", () => {
  it("404 when tenant missing", async () => {
    admin = makeAdmin({ tenant: null });
    const res = await GET({ params: { tenantKey: "acme", roomId: "r1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when room missing", async () => {
    admin = makeAdmin({ tenant: tenantRow, room: null });
    const res = await GET({ params: { tenantKey: "acme", roomId: "r1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("builds a full snapshot for a named room", async () => {
    admin = makeAdmin({
      tenant: tenantRow,
      room: { id: "r1", name: "Hall", color_scheme_id: "cs1", template: null },
      entries: [
        {
          id: "e1",
          kind: "entry",
          time: new Date(Date.now() + 60_000).toISOString(),
          end_time: null,
          title: "Talk",
          description: "d",
          tags: ["Hall"],
          color_scheme_id: "cs1",
          slide_set_id: null,
          background_path: "bg/e1.png",
          background_align: "left-top",
          background_height: 50,
          background_opacity: 90,
          background_margin: 2,
          background_tint: "#fff",
        },
        {
          id: "e2",
          kind: "slides",
          time: new Date(Date.now() - 1000).toISOString(),
          end_time: null,
          title: "Slideshow entry",
          description: "",
          tags: [],
          color_scheme_id: null,
          slide_set_id: null,
          background_path: null,
          background_align: null,
          background_height: null,
          background_opacity: null,
          background_margin: null,
          background_tint: null,
        },
        {
          id: "e3",
          kind: "entry",
          time: new Date(Date.now() - 3_600_000).toISOString(),
          end_time: null,
          title: "Old",
          description: "",
          tags: ["Other room"],
          color_scheme_id: null,
          slide_set_id: null,
          background_path: null,
          background_align: null,
          background_height: null,
          background_opacity: null,
          background_margin: null,
          background_tint: null,
        },
      ],
      schemes: [{ id: "cs1", color: "#abc" }],
      teams: [{ id: "team1", name: "T1", room_id: "r1", sort_order: 0, created_at: "now" }],
      rooms: [{ id: "r1", color_scheme_id: "cs1" }],
    });
    const res = await GET({ params: { tenantKey: "acme", roomId: "r1" }, request: req() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room.name).toBe("Hall");
    expect(body.room.color).toBe("#abc");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].background_url).toContain("/api/public/entry-bg/acme/e1");
    expect(body.teams).toHaveLength(1);
    expect(body.tenant.reload_counter).toBe(0);
  });

  it("builds the overview snapshot", async () => {
    admin = makeAdmin({
      tenant: tenantRow,
      entries: [],
      schemes: [],
      teams: [],
      rooms: [],
    });
    const res = await GET({ params: { tenantKey: "acme", roomId: "overview" }, request: req() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room.is_overview).toBe(true);
    expect(body.room.id).toBe("overview");
  });
});
