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

function makeChannel() {
  const handlers: Array<() => void> = [];
  const ch = {
    on: (_t: string, _f: unknown, cb: () => void) => {
      handlers.push(cb);
      return ch;
    },
    subscribe: () => ch,
  };
  return { ch, handlers };
}

function makeAdmin(opts: {
  tenant?: unknown;
  room?: unknown;
  entries?: unknown[];
  schemes?: unknown[];
  teams?: unknown[];
  rooms?: unknown[];
}) {
  let roomCall = 0;
  const { ch, handlers } = makeChannel();
  return {
    from: (table: string) => {
      switch (table) {
        case "tenants":
          return chain({ data: opts.tenant ?? null, error: null });
        case "rooms":
          roomCall++;
          if (roomCall <= 2) return chain({ data: "room" in opts ? opts.room : null, error: null });
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
    channel: () => ch,
    removeChannel: vi.fn(),
    _handlers: handlers,
  };
}

let admin: ReturnType<typeof makeAdmin>;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => admin }));

import { Route } from "@/routes/api/public/stream.$tenantKey.$roomId";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;
const req = () => new Request("http://x/api/public/stream/acme/r1");

async function readSse(res: Response, events: number, onEach?: (chunk: string) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = 0;
  let buf = "";
  while (seen < events) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    buf += chunk;
    onEach?.(chunk);
    seen += (chunk.match(/^event: /gm) ?? []).length;
  }
  return buf;
}

describe("stream route", () => {
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

  it("streams a snapshot then pushes an update on table change, and cleans up on abort", async () => {
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
          tags: [],
          color_scheme_id: "cs1",
          slide_set_id: null,
          background_path: "bg/e1.png",
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
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    const firstText = decoder.decode(first.value);
    expect(firstText).toContain("event: snapshot");
    expect(firstText).toContain("\"name\":\"Hall\"");

    // Trigger every registered postgres_changes handler to cover update push.
    for (const h of admin._handlers) h();
    const second = await reader.read();
    const secondText = decoder.decode(second.value);
    expect(secondText).toContain("event: update");

    await reader.cancel();
    expect(admin.removeChannel).toHaveBeenCalled();
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
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    const text = decoder.decode(first.value);
    expect(text).toContain("\"is_overview\":true");
    await reader.cancel();
  });

  it("aborts cleanly via AbortController before any read", async () => {
    admin = makeAdmin({
      tenant: tenantRow,
      room: { id: "r1", name: "Hall", color_scheme_id: null, template: null },
      entries: [],
      schemes: [],
      teams: [],
      rooms: [],
    });
    const controller = new AbortController();
    const request = new Request("http://x/api/public/stream/acme/r1", { signal: controller.signal });
    const res = await GET({ params: { tenantKey: "acme", roomId: "r1" }, request });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel();
    expect(admin.removeChannel).toHaveBeenCalled();
  });
});
