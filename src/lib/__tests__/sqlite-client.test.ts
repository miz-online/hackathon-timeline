import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The real SQLite engine runs against a throwaway directory; the change bus
// and file storage are mocked so no SSE/filesystem side effects leak out.
const published: { table: string; tenantId: string | null }[] = [];
vi.mock("@/lib/backend/events.server", () => ({
  publishChange: (e: { table: string; tenantId: string | null }) => published.push(e),
  subscribeChanges: () => () => {},
}));
vi.mock("../backend/events.server", () => ({
  publishChange: (e: { table: string; tenantId: string | null }) => published.push(e),
  subscribeChanges: () => () => {},
}));
vi.mock("../backend/local-storage.server", () => ({ localStorageApi: () => ({}) }));

type Client = ReturnType<typeof import("@/lib/backend/sqlite-client.server").createLocalClient>;
let db: Client;

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-test-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
});

describe("local SQLite backend", () => {
  it("applies schema defaults on insert and publishes a change", async () => {
    const { data, error } = await db.from("tenants").insert({ key: "k1" }).select().single();
    expect(error).toBeNull();
    const row = data as Record<string, unknown>;
    expect(row["id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({ name: "My organization", template: "zeitplan", team_edit_locked: false });
    expect(published.at(-1)).toEqual({ table: "tenants", tenantId: null });
  });

  it("filters, orders and limits", async () => {
    await db.from("tenants").insert([{ key: "k2", name: "B" }, { key: "k3", name: "A" }]);
    const { data } = await db.from("tenants").select("key, name").in("key", ["k2", "k3"]).order("name");
    expect(data).toEqual([{ key: "k3", name: "A" }, { key: "k2", name: "B" }]);
    const one = await db.from("tenants").select("key").neq("key", "k1").order("key", { ascending: false }).limit(1);
    expect(one.data).toEqual([{ key: "k3" }]);
    expect((await db.from("tenants").select().in("key", [])).data).toEqual([]);
  });

  it("maybeSingle / single on missing rows", async () => {
    expect(await db.from("tenants").select().eq("key", "none").maybeSingle()).toEqual({ data: null, error: null });
    expect((await db.from("tenants").select().eq("key", "none").single()).error).not.toBeNull();
  });

  it("rejects unknown columns with the Postgres error code", async () => {
    const { error } = await db.from("tenants").select("bogus");
    expect(error).toMatchObject({ code: "42703" });
  });

  it("round-trips booleans and updates", async () => {
    await db.from("tenants").update({ team_edit_locked: true }).eq("key", "k1");
    const { data } = await db.from("tenants").select("team_edit_locked").eq("key", "k1").single();
    expect(data).toEqual({ team_edit_locked: true });
    const locked = await db.from("tenants").select("key").is("team_edit_locked", true);
    expect(locked.data).toEqual([{ key: "k1" }]);
  });

  it("deletes rows", async () => {
    await db.from("tenants").delete().eq("key", "k2");
    expect((await db.from("tenants").select("key").eq("key", "k2")).data).toEqual([]);
  });
});
