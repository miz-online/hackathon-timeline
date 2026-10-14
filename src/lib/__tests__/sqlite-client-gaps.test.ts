import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { subs, unsub, rpc } = vi.hoisted(() => ({
  subs: [] as ((e: { table: string; tenantId: string | null }) => void)[],
  unsub: vi.fn(),
  rpc: vi.fn(async (n: string) => ({ data: n, error: null })),
}));
vi.mock("@/lib/backend/events.server", () => ({
  publishChange: () => {},
  subscribeChanges: (l: (e: { table: string; tenantId: string | null }) => void) => (subs.push(l), unsub),
}));
vi.mock("../backend/events.server", () => ({
  publishChange: () => {},
  subscribeChanges: (l: (e: { table: string; tenantId: string | null }) => void) => (subs.push(l), unsub),
}));
vi.mock("../backend/local-storage.server", () => ({ localStorageApi: () => ({}) }));
vi.mock("../backend/local-scheduler.server", () => ({ runLocalRpc: (n: string) => rpc(n) }));

type Client = ReturnType<typeof import("@/lib/backend/sqlite-client.server").createLocalClient>;
let db: Client;

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-sqlgap-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  await db.from("tenants").insert([
    { key: "g1", name: "Alpha", slide_seconds: 5, team_edit_locked: true },
    { key: "g2", name: "beta", slide_seconds: 10 },
    { key: "g3", name: "Gamma", slide_seconds: 15, logo_url: "x.png" },
  ]);
});

const keys = (d: unknown) => ((d as { key: string }[]) ?? []).map((r) => r.key).sort();

describe("local SQLite query operators", () => {
  it("supports comparison, pattern, is, in and not filters", async () => {
    const base = () => db.from("tenants").select("key").in("key", ["g1", "g2", "g3"]);
    expect(keys((await base().neq("key", "g1")).data)).toEqual(["g2", "g3"]);
    expect(keys((await base().gt("slide_seconds", 5)).data)).toEqual(["g2", "g3"]);
    expect(keys((await base().gte("slide_seconds", 10)).data)).toEqual(["g2", "g3"]);
    expect(keys((await base().lt("slide_seconds", 10)).data)).toEqual(["g1"]);
    expect(keys((await base().lte("slide_seconds", 10)).data)).toEqual(["g1", "g2"]);
    expect(keys((await base().like("name", "Al%")).data)).toEqual(["g1"]);
    expect(keys((await base().ilike("name", "BETA")).data)).toEqual(["g2"]);
    expect(keys((await base().is("logo_url", null)).data)).toEqual(["g1", "g2"]);
    expect(keys((await base().is("team_edit_locked", true)).data)).toEqual(["g1"]);
    expect(keys((await base().is("team_edit_locked", false)).data)).toEqual(["g2", "g3"]);
    expect(keys((await base().not("logo_url", "is", null)).data)).toEqual(["g3"]);
    expect(keys((await base().not("key", "eq", "g1")).data)).toEqual(["g2", "g3"]);
    expect((await db.from("tenants").select("key").in("key", [])).data).toEqual([]);
    const desc = await base().order("slide_seconds", { ascending: false }).limit(1);
    expect(keys(desc.data)).toEqual(["g3"]);
  });

  it("reports SQL errors and supports .catch()", async () => {
    const r = await db.from("tenants").insert({ key: "g1" });
    expect(r.error?.message).toMatch(/UNIQUE/i);
    const r2 = await db.from("tenants").select("nope");
    expect(r2.error).toMatchObject({ code: "42703" });
    const caught = await db.from("tenants").select("key").eq("key", "g1").catch(() => "x");
    expect(caught).toMatchObject({ error: null });
  });

  it("routes rpc calls and channel events", async () => {
    expect(await db.rpc("next_webhook_dispatch_at")).toEqual({ data: "next_webhook_dispatch_at", error: null });
    const cb = vi.fn();
    const ch = db.channel("c").on("postgres_changes", { table: "teams" }, cb).on("x", {}, cb).subscribe();
    await vi.waitFor(() => expect(subs.length).toBeGreaterThan(0));
    subs.at(-1)!({ table: "teams", tenantId: null });
    subs.at(-1)!({ table: "rooms", tenantId: null });
    expect(cb).toHaveBeenCalledTimes(1);
    db.removeChannel(ch);
    expect(unsub).toHaveBeenCalled();
  });
});
