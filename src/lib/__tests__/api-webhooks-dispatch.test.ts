import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

const sendWebhookMock = vi.fn();
vi.mock("@/lib/webhooks", () => ({ sendWebhook: (...args: unknown[]) => sendWebhookMock(...args) }));

const greyscalePngMock = vi.fn();
vi.mock("@/lib/image-grey.server", () => ({ greyscalePng: (...args: unknown[]) => greyscalePngMock(...args) }));

type Resp = { data: unknown; error: unknown };
function chain(resp: Resp) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "eq", "gt", "lte", "is", "order", "update"]) obj[m] = () => obj;
  obj.maybeSingle = () => Promise.resolve(resp);
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resp).then(res as never, rej as never);
  return obj;
}

let isLocalBackend = true;
let fromTables: Record<string, unknown>;
let downloadResult: { data: { arrayBuffer: () => Promise<ArrayBuffer>; type: string } | null };
let rpcResult: { data: unknown };
let updateCalls: { table: string; payload: unknown }[];

function entriesChain() {
  let kind: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "gt", "lte", "is", "order"]) obj[m] = () => obj;
  obj.eq = (col: string, val: unknown) => {
    if (col === "kind") kind = val as string;
    return obj;
  };
  obj.update = (payload: unknown) => {
    updateCalls.push({ table: kind === "practice" ? "entries(practice)" : "entries", payload });
    return obj;
  };
  const resolve = () => {
    const data = kind === "practice" ? (fromTables.practices ?? []) : (fromTables.entries ?? []);
    return { data, error: null };
  };
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resolve()).then(res as never, rej as never);
  return obj;
}

function makeAdmin() {
  updateCalls = [];
  return {
    from: (table: string) => {
      if (table === "entries") return entriesChain();
      const data = fromTables[table];
      const c = chain({ data: Array.isArray(data) ? data : (data ?? null), error: null });
      const origUpdate = c.update;
      c.update = (payload: unknown) => {
        updateCalls.push({ table, payload });
        return origUpdate(payload);
      };
      return c;
    },
    storage: {
      from: () => ({
        download: async () => downloadResult,
      }),
    },
    rpc: async () => rpcResult,
  };
}

let admin: ReturnType<typeof makeAdmin>;
vi.mock("@/lib/backend/admin.server", () => ({
  getBackendAdmin: async () => admin,
  isLocalBackend: () => isLocalBackend,
}));

import { Route } from "@/routes/api/public/webhooks-dispatch";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const POST = (Route as any).server.handlers.POST;

function req(headers: Record<string, string> = {}) {
  return new Request("http://x/api/public/webhooks-dispatch", { method: "POST", headers });
}

describe("webhooks-dispatch route", () => {
  beforeEach(() => {
    isLocalBackend = true;
    fromTables = {};
    downloadResult = { data: null };
    rpcResult = { data: "2024-01-01T00:00:00Z" };
    sendWebhookMock.mockReset().mockResolvedValue({ ok: true });
    greyscalePngMock.mockReset().mockReturnValue(null);
    delete process.env["SUPABASE_ANON_KEY"];
    delete process.env["SUPABASE_PUBLISHABLE_KEY"];
    delete process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("401s on non-local backend with no/invalid apikey", async () => {
    isLocalBackend = false;
    const res = await POST({ request: req() });
    expect(res.status).toBe(401);
  });

  it("allows non-local backend with a valid apikey", async () => {
    isLocalBackend = false;
    process.env["SUPABASE_ANON_KEY"] = "secret";
    fromTables = { tenants: [] };
    admin = makeAdmin();
    const res = await POST({ request: req({ apikey: "secret" }) });
    expect(res.status).toBe(200);
  });

  it("processes no tenants", async () => {
    fromTables = { tenants: [] };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
    expect(body.nextRun).toBe("2024-01-01T00:00:00Z");
  });

  it("skips tenants with no enabled webhooks", async () => {
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [],
    };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("dispatches due entries with a color scheme and a plain (non-tinted) background image", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [
        {
          id: "e1",
          time: new Date(now).toISOString(),
          end_time: new Date(now + 60_000).toISOString(),
          title: "Talk",
          description: "d",
          color_scheme_id: "cs1",
          notify: true,
          notified_at: null,
          background_path: "bg/e1.png",
          background_content_type: "image/png",
          background_tint: null,
        },
      ],
      color_schemes: { color: "#abc" },
      practices: [],
    };
    downloadResult = { data: { arrayBuffer: async () => new ArrayBuffer(4), type: "image/png" } };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ tenant: "Acme", webhook: "Discord", entry: "Talk", ok: true });
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      expect.objectContaining({ color: "#abc", image: expect.objectContaining({ filename: "e1.png" }) }),
    );
    expect(updateCalls.some((c) => c.table.startsWith("entries") && (c.payload as { notified_at?: unknown }).notified_at)).toBe(
      true,
    );
  });

  it("re-shades a tinted PNG background to grey before sending", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [
        {
          id: "e1",
          time: new Date(now).toISOString(),
          end_time: null,
          title: "Talk",
          description: "d",
          color_scheme_id: null,
          notify: true,
          notified_at: null,
          background_path: "bg/e1.png",
          background_content_type: "image/png",
          background_tint: "#fff",
        },
      ],
      practices: [],
    };
    downloadResult = { data: { arrayBuffer: async () => new ArrayBuffer(4), type: "image/png" } };
    greyscalePngMock.mockReturnValue(new Uint8Array([1, 2, 3]));
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0].ok).toBe(true);
    expect(greyscalePngMock).toHaveBeenCalled();
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      expect.objectContaining({ color: "#111", image: expect.objectContaining({ filename: "e1.png", contentType: "image/png" }) }),
    );
  });

  it("records a failed entry webhook without marking it notified", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [
        {
          id: "e1",
          time: new Date(now).toISOString(),
          end_time: null,
          title: "Talk",
          description: "d",
          color_scheme_id: null,
          notify: true,
          notified_at: null,
          background_path: null,
          background_content_type: null,
          background_tint: null,
        },
      ],
      practices: [],
    };
    sendWebhookMock.mockResolvedValue({ ok: false, error: "boom" });
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, error: "boom" });
    expect(updateCalls.some((c) => c.table.startsWith("entries"))).toBe(false);
  });

  it("dispatches due practice-team slots and marks notified teams, including a tinted background", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [],
      practices: [
        {
          id: "p1",
          time: new Date(now).toISOString(),
          title: "Practice",
          notify: true,
          notified_teams: [],
          background_path: "bg/p1.png",
          background_content_type: "image/png",
          background_tint: "#fff",
        },
      ],
      teams: [{ id: "team1", name: "Team 1", room_id: "r1" }],
      rooms: [{ id: "r1", color_scheme_id: "cs1" }],
      color_schemes: [{ id: "cs1", color: "#xyz" }],
    };
    downloadResult = { data: { arrayBuffer: async () => new ArrayBuffer(4), type: "image/png" } };
    greyscalePngMock.mockReturnValue(new Uint8Array([9]));
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ tenant: "Acme", entry: "Practice — Team 1", ok: true });
    expect(updateCalls.some((c) => c.table.startsWith("entries") && (c.payload as { notified_teams?: unknown[] }).notified_teams?.includes("team1"))).toBe(
      true,
    );
  });

  it("skips practice entries with no due teams", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [],
      practices: [
        {
          id: "p1",
          time: new Date(now - 48 * 3600_000).toISOString(),
          title: "Old practice",
          notify: true,
          notified_teams: ["team1"],
          background_path: null,
          background_content_type: null,
          background_tint: null,
        },
      ],
      teams: [{ id: "team1", name: "Team 1", room_id: null }],
      rooms: [],
      color_schemes: [],
    };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results).toHaveLength(0);
  });
});

describe("webhooks-dispatch route edge cases", () => {
  beforeEach(() => {
    isLocalBackend = true;
    fromTables = {};
    downloadResult = { data: null };
    rpcResult = { data: null };
    sendWebhookMock.mockReset().mockResolvedValue({ ok: true });
    greyscalePngMock.mockReset().mockReturnValue(null);
  });

  it("falls back to empty arrays when queries return null data", async () => {
    fromTables = { tenants: null };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.processed).toBe(0);
    expect(body.nextRun).toBeNull();
  });

  it("falls back on missing grace/practice minutes and a null entries/scheme result", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: null, practice_minutes: null }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [
        {
          id: "e1",
          time: new Date(now).toISOString(),
          end_time: null,
          title: "Talk",
          description: "d",
          color_scheme_id: "cs1",
          notify: true,
          notified_at: null,
          background_path: "bg/e1",
          background_content_type: null,
          background_tint: null,
        },
      ],
      color_schemes: null,
      practices: [],
    };
    downloadResult = { data: { arrayBuffer: async () => new ArrayBuffer(4), type: "image/jpeg" } };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0].ok).toBe(true);
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      // scheme lookup returns null -> falls back to tenant.accent_color
      expect.objectContaining({ color: "#111", image: expect.objectContaining({ contentType: "image/jpeg", filename: "e1" }) }),
    );
  });

  it("skips attaching an image when the storage download returns no file", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [
        {
          id: "e1",
          time: new Date(now).toISOString(),
          end_time: null,
          title: "Talk",
          description: "d",
          color_scheme_id: null,
          notify: true,
          notified_at: null,
          background_path: "bg/e1.png",
          background_content_type: "image/png",
          background_tint: "#fff",
        },
      ],
      practices: [],
    };
    downloadResult = { data: null };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0].ok).toBe(true);
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      expect.objectContaining({ image: null }),
    );
  });

  it("uses tenant accent color for a team in a room with no color scheme, and null teamRooms/schemes fallback", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: null }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [],
      practices: [
        {
          id: "p1",
          time: new Date(now).toISOString(),
          title: "Practice",
          notify: true,
          notified_teams: null,
          background_path: null,
          background_content_type: null,
          background_tint: null,
        },
      ],
      teams: [{ id: "team1", name: "Team 1", room_id: null }],
      rooms: null,
      color_schemes: null,
    };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: true });
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      expect.objectContaining({ color: "#111" }),
    );
  });

  it("uses a room's own color scheme for a practice team and skips image on a missing storage file", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [],
      practices: [
        {
          id: "p1",
          time: new Date(now).toISOString(),
          title: "Practice",
          notify: true,
          notified_teams: [],
          background_path: "bg/p1.png",
          background_content_type: null,
          background_tint: null,
        },
      ],
      teams: [{ id: "team1", name: "Team 1", room_id: "r1" }],
      rooms: [{ id: "r1", color_scheme_id: "cs1" }],
      color_schemes: [{ id: "cs1", color: "#xyz" }],
    };
    downloadResult = { data: null };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: true });
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      expect.objectContaining({ color: "#xyz", image: null }),
    );
  });

  it("records a failed practice webhook and does not mark the team notified", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [],
      practices: [
        {
          id: "p1",
          time: new Date(now).toISOString(),
          title: "Practice",
          notify: true,
          notified_teams: [],
          background_path: null,
          background_content_type: null,
          background_tint: null,
        },
      ],
      teams: [{ id: "team1", name: "Team 1", room_id: null }],
      rooms: [],
      color_schemes: [],
    };
    sendWebhookMock.mockResolvedValue({ ok: false, error: "nope" });
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, error: "nope" });
    // notified_teams is still persisted (empty) since the practice had a due slot.
    expect(
      updateCalls.some(
        (c) => c.table.startsWith("entries") && (c.payload as { notified_teams?: unknown[] }).notified_teams?.length === 0,
      ),
    ).toBe(true);
  });
});

describe("webhooks-dispatch route tinted practice image", () => {
  beforeEach(() => {
    isLocalBackend = true;
    fromTables = {};
    downloadResult = { data: null };
    rpcResult = { data: null };
    sendWebhookMock.mockReset().mockResolvedValue({ ok: true });
    greyscalePngMock.mockReset().mockReturnValue(new Uint8Array([7]));
  });

  it("re-shades a tinted practice background to grey and matches the team's room color scheme", async () => {
    const now = Date.now();
    fromTables = {
      tenants: [{ id: "t1", name: "Acme", accent_color: "#111", past_grace_minutes: 5, practice_minutes: 10 }],
      webhooks: [{ id: "w1", name: "Discord", url: "http://hook", type: "discord" }],
      entries: [],
      practices: [
        {
          id: "p1",
          time: new Date(now).toISOString(),
          title: "Practice",
          notify: true,
          notified_teams: [],
          background_path: "bg/p1",
          background_content_type: null,
          background_tint: "#fff",
        },
      ],
      teams: [{ id: "team1", name: "Team 1", room_id: "r1" }],
      rooms: [{ id: "r1", color_scheme_id: "cs1" }],
      color_schemes: [{ id: "cs1", color: "#xyz" }],
    };
    downloadResult = { data: { arrayBuffer: async () => new ArrayBuffer(4), type: "image/png" } };
    admin = makeAdmin();
    const res = await POST({ request: req() });
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: true });
    expect(greyscalePngMock).toHaveBeenCalled();
    expect(sendWebhookMock).toHaveBeenCalledWith(
      "http://hook",
      "discord",
      expect.objectContaining({ color: "#xyz", image: expect.objectContaining({ filename: "p1.png", contentType: "image/png" }) }),
    );
  });
});
