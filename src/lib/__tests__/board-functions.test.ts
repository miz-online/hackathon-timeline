import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn → plain async function running validator + handler in-process.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (v: (d: unknown) => unknown) => ((validate = v), b),
      handler: (h: (ctx: { data: unknown }) => unknown) => (arg?: { data?: unknown }) =>
        Promise.resolve().then(() => h({ data: validate(arg?.data) })),
    };
    return b;
  },
}));

// Real SQLite engine in a throwaway dir; change bus, file storage and PIN sessions faked.
vi.mock("@/lib/backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {} }));
vi.mock("../backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {} }));
vi.mock("../backend/local-storage.server", () => ({ localStorageApi: () => ({}) }));
let db: unknown;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => db, isLocalBackend: () => true }));
const unlocked = vi.fn(async () => true);
vi.mock("@/lib/tenant-auth.server", () => ({
  isTenantUnlocked: () => unlocked(),
  markTenantUnlocked: async () => {},
  hashPin: async (p: string) => `h:${p}`,
}));

type Fns = typeof import("@/lib/board.functions");
let fns: Fns;
let key: string;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  unlocked.mockReset().mockResolvedValue(true);
  key = (await call(fns.createTenant, {})).key;
});

describe("tenants", () => {
  it("creates a tenant with readable defaults", async () => {
    expect(key).toMatch(/^[A-HJ-NP-Z2-9]{24}$/);
    const t = await call(fns.getTenant, { key });
    expect(t).toMatchObject({ name: "My organization", files_mode: "full", max_upload_mb: 10, team_quota_mb: 0, team_edit_locked: false });
    expect(t).not.toHaveProperty("pin_hash");
  });
  it("rejects unknown keys", async () => {
    await expect(call(fns.getTenant, { key: "nope" })).rejects.toThrow("Unknown tenant key");
  });
});

describe("rooms", () => {
  it("creates, lists sorted, updates and deletes", async () => {
    const b = await call(fns.upsertRoom, { key, room: { name: "B-Raum", ref_id: "Bühne" } });
    await call(fns.upsertRoom, { key, room: { name: "A-Raum" } });
    let rooms = await call(fns.listRooms, { key });
    expect(rooms.map((r) => r.name)).toEqual(["A-Raum", "B-Raum"]);
    expect(rooms[1].ref_id).toBe("buehne");
    await call(fns.upsertRoom, { key, room: { id: b.id, name: "C-Raum" } });
    await call(fns.deleteRoom, { key, id: b.id });
    rooms = await call(fns.listRooms, { key });
    expect(rooms.map((r) => r.name)).toEqual(["A-Raum"]);
  });
});

describe("teams", () => {
  it("appends new teams at the end and reorders", async () => {
    const a = await call(fns.upsertTeam, { key, team: { name: "Alpha Team" } });
    const b = await call(fns.upsertTeam, { key, team: { name: "Beta" } });
    let teams = await call(fns.listTeams, { key });
    expect(teams.map((t) => [t.name, t.sort_order, t.ref_id])).toEqual([
      ["Alpha Team", 0, "alpha-team"],
      ["Beta", 1, "beta"],
    ]);
    await call(fns.reorderTeams, { key, ids: [b.id, a.id] });
    teams = await call(fns.listTeams, { key });
    expect(teams.map((t) => t.name)).toEqual(["Beta", "Alpha Team"]);
  });
  it("updates and deletes only within the own tenant", async () => {
    const other = (await call(fns.createTenant, {})).key;
    const a = await call(fns.upsertTeam, { key, team: { name: "Mine" } });
    await call(fns.deleteTeam, { key: other, id: a.id });
    expect(await call(fns.listTeams, { key })).toHaveLength(1);
    await call(fns.upsertTeam, { key: other, team: { id: a.id, name: "Hijack" } });
    expect((await call(fns.listTeams, { key }))[0].name).toBe("Mine");
    await call(fns.deleteTeam, { key, id: a.id });
    expect(await call(fns.listTeams, { key })).toEqual([]);
  });
  it("validates input", async () => {
    await expect(call(fns.upsertTeam, { key, team: { name: "" } })).rejects.toThrow();
    await expect(call(fns.reorderTeams, { key, ids: ["not-a-uuid"] })).rejects.toThrow();
  });
});

describe("PIN-protected tenants", () => {
  it("returns empty lists while locked but refuses writes", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    await call(fns.upsertTeam, { key: locked, team: { name: "T" } });
    unlocked.mockResolvedValue(false);
    expect(await call(fns.listTeams, { key: locked })).toEqual([]);
    expect(await call(fns.listRooms, { key: locked })).toEqual([]);
    await expect(call(fns.upsertTeam, { key: locked, team: { name: "X" } })).rejects.toThrow("TENANT_LOCKED");
    unlocked.mockResolvedValue(true);
    expect(await call(fns.listTeams, { key: locked })).toHaveLength(1);
  });
});
