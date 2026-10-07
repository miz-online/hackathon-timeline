import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let changeListener: ((e: { table: string; tenantId: string | null }) => void) | null = null;

vi.mock("@/lib/backend/events.server", () => ({
  onChangeInternal: vi.fn((cb: any) => {
    changeListener = cb;
  }),
}));
vi.mock("../backend/events.server", () => ({
  onChangeInternal: vi.fn((cb: any) => {
    changeListener = cb;
  }),
}));

type Tenant = { id: string; past_grace_minutes?: number; practice_minutes?: number; practice_room_scope?: string };

let tenants: Tenant[] = [];
let teamCounts: Record<string, number> = {};
let entriesByTenant: Record<string, Record<string, unknown>[]> = {};

const dbStub = {
  prepare(sql: string) {
    return {
      all(...args: unknown[]) {
        if (sql.includes("from tenants t")) return tenants;
        if (sql.startsWith("select count(*) as c from teams")) {
          const tenantId = String(args[0]);
          return [{ c: teamCounts[tenantId] ?? 0 }];
        }
        if (sql.includes("from entries")) {
          const tenantId = String(args[0]);
          return entriesByTenant[tenantId] ?? [];
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
  },
};

vi.mock("../backend/sqlite-db.server", () => ({
  getDb: vi.fn(async () => dbStub),
}));

async function freshModule() {
  vi.resetModules();
  return import("../backend/local-scheduler.server");
}

describe("local-scheduler", () => {
  beforeEach(() => {
    tenants = [];
    teamCounts = {};
    entriesByTenant = {};
    changeListener = null;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when there is nothing due", async () => {
    const { runLocalRpc } = await freshModule();
    const res = await runLocalRpc("next_webhook_dispatch_at");
    expect(res).toEqual({ data: null, error: null });
  });

  it("returns null data for an unknown rpc name", async () => {
    const { runLocalRpc } = await freshModule();
    const res = await runLocalRpc("something_else");
    expect(res).toEqual({ data: null, error: null });
  });

  it("computes the earliest due non-practice entry, skipping already-notified or too-old ones", async () => {
    tenants = [{ id: "t1", past_grace_minutes: 15 }];
    const now = Date.now();
    entriesByTenant["t1"] = [
      { id: "e1", kind: "entry", time: new Date(now + 10_000).toISOString(), notified_at: null, notified_teams: "[]" },
      { id: "e2", kind: "entry", time: new Date(now + 5_000).toISOString(), notified_at: null, notified_teams: "[]" },
      { id: "e3", kind: "entry", time: new Date(now + 1_000).toISOString(), notified_at: "already", notified_teams: "[]" },
      { id: "e4", kind: "entry", time: "not-a-date", notified_at: null, notified_teams: "[]" },
      { id: "e5", kind: "entry", time: new Date(now - 999_999_999).toISOString(), notified_at: null, notified_teams: "[]" },
    ];
    const { runLocalRpc } = await freshModule();
    const res = await runLocalRpc("next_webhook_dispatch_at");
    expect(res.data).toBe(new Date(now + 5_000).toISOString());
  });

  it("computes practice slots per team, honoring notified_teams and malformed JSON", async () => {
    tenants = [{ id: "t1", past_grace_minutes: 15, practice_minutes: 10 }];
    teamCounts["t1"] = 3;
    const now = Date.now();
    const start = new Date(now).toISOString();
    entriesByTenant["t1"] = [
      { id: "p1", kind: "practice", time: start, notified_at: null, notified_teams: "not json" },
      { id: "p2", kind: "practice", time: new Date(now + 100_000).toISOString(), notified_at: null, notified_teams: JSON.stringify(["a"]) },
    ];
    const { runLocalRpc } = await freshModule();
    const res = await runLocalRpc("next_webhook_dispatch_at");
    expect(res.data).toBe(start);
  });

  it("skips practice slots that are already past the grace window", async () => {
    tenants = [{ id: "t1", past_grace_minutes: 0, practice_minutes: 10 }];
    teamCounts["t1"] = 2;
    const now = Date.now();
    entriesByTenant["t1"] = [
      { id: "p1", kind: "practice", time: new Date(now - 999_999_999).toISOString(), notified_at: null, notified_teams: "[]" },
    ];
    const { runLocalRpc } = await freshModule();
    const res = await runLocalRpc("next_webhook_dispatch_at");
    expect(res.data).toBeNull();
  });

  it("arms a timeout, dispatches on fire, and reschedules; errors in fetch are caught", async () => {
    tenants = [{ id: "t1", past_grace_minutes: 15 }];
    const now = Date.now();
    entriesByTenant["t1"] = [
      { id: "e1", kind: "entry", time: new Date(now + 5_000).toISOString(), notified_at: null, notified_teams: "[]" },
    ];
    (fetch as any).mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { ensureStarted, runLocalRpc } = await freshModule();
    ensureStarted();
    // second call is a no-op (already armed)
    ensureStarted();
    expect(changeListener).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/public/webhooks-dispatch"), { method: "POST" });
    expect(errorSpy).toHaveBeenCalled();

    // reschedule rpc re-arms and returns the next dispatch time
    entriesByTenant["t1"] = [
      { id: "e2", kind: "entry", time: new Date(Date.now() + 20_000).toISOString(), notified_at: null, notified_teams: "[]" },
    ];
    const res = await runLocalRpc("reschedule_webhook_dispatch");
    expect(res.data).not.toBeNull();

    // a watched-table change event re-arms too
    changeListener?.({ table: "entries", tenantId: "t1" });
    changeListener?.({ table: "unwatched", tenantId: "t1" });
    await vi.advanceTimersByTimeAsync(0);
  });

  it("uses PUBLIC_BASE_URL when set", async () => {
    const prev = process.env["PUBLIC_BASE_URL"];
    process.env["PUBLIC_BASE_URL"] = "https://example.test";
    tenants = [{ id: "t1", past_grace_minutes: 15 }];
    entriesByTenant["t1"] = [
      { id: "e1", kind: "entry", time: new Date(Date.now() + 1_000).toISOString(), notified_at: null, notified_teams: "[]" },
    ];
    const { ensureStarted } = await freshModule();
    ensureStarted();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledWith("https://example.test/api/public/webhooks-dispatch", { method: "POST" });
    if (prev === undefined) delete process.env["PUBLIC_BASE_URL"];
    else process.env["PUBLIC_BASE_URL"] = prev;
  });

  it("caps the delay at the hourly maximum", async () => {
    tenants = [{ id: "t1", past_grace_minutes: 15 }];
    entriesByTenant["t1"] = [
      { id: "e1", kind: "entry", time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(), notified_at: null, notified_teams: "[]" },
    ];
    const { ensureStarted } = await freshModule();
    ensureStarted();
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
