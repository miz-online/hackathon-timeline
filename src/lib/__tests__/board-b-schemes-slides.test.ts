import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {} }));
vi.mock("../backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {} }));
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
const png = () => ({ filename: "a.png", contentType: "image/png", dataBase64: Buffer.from("hi").toString("base64") });

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-b-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  unlocked.mockReset().mockResolvedValue(true);
  key = (await call(fns.createTenant, {})).key;
});

describe("color schemes", () => {
  it("creates, lists, updates, deletes; empty for unknown tenant", async () => {
    await expect(call(fns.listColorSchemes, { key: "nope" })).rejects.toThrow("Unknown tenant key");
    const created = await call(fns.upsertColorScheme, { key, scheme: { name: "Red", color: "#ff0000", ref_id: "Rot" } });
    let rows = await call(fns.listColorSchemes, { key });
    expect(rows).toHaveLength(1);
    expect(rows[0].ref_id).toBe("rot");
    expect(rows[0].color).toBe("#FF0000");
    await call(fns.upsertColorScheme, { key, scheme: { id: created.id, name: "Red2", color: "#00ff00" } });
    rows = await call(fns.listColorSchemes, { key });
    expect(rows[0].name).toBe("Red2");
    await call(fns.deleteColorScheme, { key, id: created.id });
    expect(await call(fns.listColorSchemes, { key })).toEqual([]);
  });
});

describe("tenant logo", () => {
  it("uploads, replaces and removes a logo", async () => {
    await call(fns.uploadTenantLogo, { key, ...png() });
    let t = await call(fns.getTenant, { key });
    expect(t.logo_url).toMatch(/logo-/);
    const first = t.logo_url;
    await call(fns.uploadTenantLogo, { key, ...png() });
    t = await call(fns.getTenant, { key });
    expect(t.logo_url).not.toBe(first);
    await call(fns.removeTenantLogo, { key });
    t = await call(fns.getTenant, { key });
    expect(t.logo_url).toBeNull();
  });
  it("removeTenantLogo is a no-op when there is no logo", async () => {
    await call(fns.removeTenantLogo, { key });
    const t = await call(fns.getTenant, { key });
    expect(t.logo_url).toBeNull();
  });
});

describe("slide sets", () => {
  it("creates, lists ordered, updates, deletes and resets templates", async () => {
    await expect(call(fns.listSlideSets, { key: "nope" })).rejects.toThrow("Unknown tenant key");
    const s1 = await call(fns.upsertSlideSet, { key, set: { name: "Set1" } });
    const s2 = await call(fns.upsertSlideSet, { key, set: { name: "Set2" } });
    let sets = await call(fns.listSlideSets, { key });
    expect(sets.map((s) => s.name)).toEqual(["Set1", "Set2"]);
    await call(fns.upsertSlideSet, { key, set: { id: s1.id, name: "Set1 renamed" } });
    sets = await call(fns.listSlideSets, { key });
    expect(sets[0].name).toBe("Set1 renamed");

    // make the tenant template and a room template point at s2, then delete it
    await call(fns.updateTenantSettings, { key, name: "Org", past_grace_minutes: 0, template: `slides:${s2.id}`, logo_height: 40, accent_color: "#111111", slide_seconds: 10, focus_mode: "count", focus_count: 3, focus_minutes: 30, focus_dim_opacity: 35 });
    const room = await call(fns.upsertRoom, { key, room: { name: "R1", template: `slides:${s2.id}` } });
    await call(fns.deleteSlideSet, { key, id: s2.id });
    const t = await call(fns.getTenant, { key });
    expect(t.template).toBe("zeitplan");
    const rooms = await call(fns.listRooms, { key });
    expect(rooms.find((r) => r.id === room.id)?.template ?? null).toBeNull();
    sets = await call(fns.listSlideSets, { key });
    expect(sets.map((s) => s.name)).toEqual(["Set1 renamed"]);
  });
});

describe("slides", () => {
  it("uploads images, lists signed, adds entries/teams slides, reorders, updates, moves and deletes", async () => {
    const set = await call(fns.upsertSlideSet, { key, set: { name: "S" } });
    expect(await call(fns.listSlides, { key, setId: set.id })).toEqual([]);
    const img1 = await call(fns.uploadSlide, { key, setId: set.id, ...png() });
    const img2 = await call(fns.uploadSlide, { key, setId: set.id, ...png() });
    const entriesSlide = await call(fns.addEntriesSlide, { key, setId: set.id, name: "Timeline" });
    const teamsSlide = await call(fns.addEntriesSlide, { key, setId: set.id, name: "Teams", kind: "teams" });

    let list = await call(fns.listSlides, { key, setId: set.id });
    expect(list.map((s) => s.kind)).toEqual(["image", "image", "entries", "teams"]);
    expect(list[0].url).toMatch(/\/api\/public\/file/);
    expect(list.find((s) => s.id === entriesSlide.id)?.url).toBeNull();

    await call(fns.reorderSlides, { key, ids: [img2.id, img1.id] });
    await call(fns.updateSlide, { key, id: img1.id, name: "Renamed", duration_seconds: 5 });
    list = await call(fns.listSlides, { key, setId: set.id });
    expect(list.find((s) => s.id === img1.id)?.name).toBe("Renamed");
    expect(list.find((s) => s.id === img1.id)?.duration_seconds).toBe(5);

    await call(fns.moveSlide, { key, id: img1.id, direction: "up" });
    await call(fns.moveSlide, { key, id: img1.id, direction: "down" });
    // out of range moves are no-ops
    const beforeMove = await call(fns.listSlides, { key, setId: set.id });
    await call(fns.moveSlide, { key, id: img2.id, direction: "up" });
    const afterMove = await call(fns.listSlides, { key, setId: set.id });
    expect(afterMove.map((s) => s.id)).toEqual(beforeMove.map((s) => s.id));
    await call(fns.moveSlide, { key, id: "00000000-0000-0000-0000-000000000000", direction: "up" });

    await call(fns.deleteSlide, { key, id: img1.id });
    await call(fns.deleteSlide, { key, id: teamsSlide.id });
    list = await call(fns.listSlides, { key, setId: set.id });
    expect(list.map((s) => s.id)).not.toContain(img1.id);
  });
});
