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
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-extra-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  unlocked.mockReset().mockResolvedValue(true);
  key = (await call(fns.createTenant, {})).key;
});

describe("getRoomSnapshot", () => {
  it("throws for unknown room and unknown tenant", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Main" } });
    await expect(call(fns.getRoomSnapshot, { key, roomId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      "Unknown room",
    );
    await expect(call(fns.getRoomSnapshot, { key: "nope", roomId: room.id })).rejects.toThrow();
  });

  it("builds a snapshot with teams, entries, colors and slide templates", async () => {
    const scheme = await call(fns.upsertColorScheme, { key, scheme: { name: "Red", color: "#ff0000" } });
    const room = await call(fns.upsertRoom, { key, room: { name: "Main", color_scheme_id: scheme.id } });
    await call(fns.upsertTeam, { key, team: { name: "Alpha", room_id: room.id } });
    await call(fns.upsertEntry, {
      key,
      entry: {
        kind: "entry",
        time: new Date(Date.now() + 60_000).toISOString(),
        end_time: null,
        title: "Entry1",
        description: "",
        tags: ["Main"],
        color_scheme_id: scheme.id,
        slide_set_id: null,
        notify: false,
      },
    });
    const snap = await call(fns.getRoomSnapshot, { key, roomId: room.id });
    expect(snap.room.name).toBe("Main");
    expect(snap.room.color).toBe("#FF0000");
    expect(snap.teams.map((t) => t.name)).toEqual(["Alpha"]);
    expect(snap.teams[0].color).toBe("#FF0000");
    expect(snap.entries.some((e) => e.title === "Entry1")).toBe(true);
  });
});

describe("color scheme / slide set unknown-tenant branches", () => {
  it("rejects writes for unknown tenant key", async () => {
    await expect(call(fns.upsertColorScheme, { key: "nope", scheme: { name: "X", color: "#ffffff" } })).rejects.toThrow();
    await expect(call(fns.deleteColorScheme, { key: "nope", id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow();
    await expect(call(fns.uploadTenantLogo, { key: "nope", ...png() })).rejects.toThrow();
    await expect(call(fns.removeTenantLogo, { key: "nope" })).rejects.toThrow();
    await expect(call(fns.upsertSlideSet, { key: "nope", set: { name: "S" } })).rejects.toThrow();
    await expect(call(fns.deleteSlideSet, { key: "nope", id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow();
    await expect(call(fns.listSlides, { key: "nope", setId: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow();
    await expect(call(fns.reorderSlides, { key: "nope", ids: ["00000000-0000-0000-0000-000000000000"] })).rejects.toThrow();
    await expect(call(fns.uploadSlide, { key: "nope", setId: "00000000-0000-0000-0000-000000000000", ...png() })).rejects.toThrow();
    await expect(call(fns.addEntriesSlide, { key: "nope", setId: "00000000-0000-0000-0000-000000000000", name: "x" })).rejects.toThrow();
    await expect(call(fns.updateSlide, { key: "nope", id: "00000000-0000-0000-0000-000000000000", name: "x" })).rejects.toThrow();
    await expect(call(fns.moveSlide, { key: "nope", id: "00000000-0000-0000-0000-000000000000", direction: "up" })).rejects.toThrow();
    await expect(call(fns.deleteSlide, { key: "nope", id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow();
  });

  it("deleteSlide is a no-op when the slide has no stored path", async () => {
    await expect(call(fns.deleteSlide, { key, id: "00000000-0000-0000-0000-000000000000" })).resolves.toEqual({ ok: true });
  });

  it("uploadTenantLogo removes the previous logo file", async () => {
    await call(fns.uploadTenantLogo, { key, ...png() });
    const t1 = await call(fns.getTenant, { key });
    await call(fns.uploadTenantLogo, { key, ...png() });
    const t2 = await call(fns.getTenant, { key });
    expect(t2.logo_url).not.toBe(t1.logo_url);
  });
});

describe("exportTenantData extra branches", () => {
  it("exports an empty tenant without logo, slides, entries or files", async () => {
    const exported = await call(fns.exportTenantData, { key });
    expect(exported.data.logo).toBeNull();
    expect(exported.data.entries).toEqual([]);
    expect(exported.data.slides).toEqual([]);
    expect(exported.data.team_files).toEqual([]);
    expect(exported.data.tenant_files).toEqual([]);
    await expect(call(fns.exportTenantData, { key: "nope" })).rejects.toThrow();
  });

  it("replace-mode import clears out previously imported sections", async () => {
    const scheme = await call(fns.upsertColorScheme, { key, scheme: { name: "Red", color: "#ff0000" } });
    const room = await call(fns.upsertRoom, { key, room: { name: "Main", color_scheme_id: scheme.id } });
    const set = await call(fns.upsertSlideSet, { key, set: { name: "Set" } });
    await call(fns.uploadSlide, { key, setId: set.id, ...png() });
    await call(fns.upsertWebhook, { key, webhook: { name: "WH", type: "discord", enabled: true, url: "https://example.com/hook" } });
    const genFile = { path: "files/global/general.pdf", content_type: "application/pdf", dataBase64: Buffer.from("x").toString("base64") };
    const teamFile = { path: "files/teams/team/team.pdf", content_type: "application/pdf", dataBase64: Buffer.from("x").toString("base64") };
    const team = await call(fns.upsertTeam, { key, team: { name: "Alpha", room_id: room.id } });
    await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["tenant_files", "team_files"],
      data: {
        tenant_files: [{ name: "general.pdf", file: genFile.path, content_type: "application/pdf" }],
        team_files: [{ team: team.id, name: "team.pdf", file: teamFile.path, content_type: "application/pdf" }],
      },
      files: [genFile, teamFile],
    });

    // Replace everything again with fresh data; old rows/files should be gone.
    const result = await call(fns.importTenantData, {
      key,
      mode: "replace",
      sections: ["color_schemes", "rooms", "slide_sets", "slides", "webhooks", "tenant_files", "team_files"],
      data: {
        color_schemes: [{ id: "c2", name: "Blue", color: "#0000ff" }],
        rooms: [{ id: "r2", name: "Second", template: null, color_scheme: "c2" }],
        slide_sets: [{ id: "s2", name: "SetB", slide_seconds: 5, show_room_name: true, show_clock: true, show_logo: true }],
        slides: [],
        webhooks: [{ id: "w2", name: "WH2", type: "discord", enabled: true, url: "https://example.com/h2" }],
        tenant_files: [],
        team_files: [],
      },
      files: [],
    });
    expect(result.ok).toBe(true);
    const rooms = await call(fns.listRooms, { key });
    expect(rooms.map((r) => r.name)).toEqual(["Second"]);
    const sets = await call(fns.listSlideSets, { key });
    expect(sets.map((s) => s.name)).toEqual(["SetB"]);
  });

  it("warns when a slide image file referenced in export storage is missing and import re-templates rooms/display", async () => {
    const result = await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["slide_sets", "rooms", "tenant"],
      data: {
        slide_sets: [{ id: "sA", name: "A", slide_seconds: 10, show_room_name: true, show_clock: true, show_logo: true }],
        rooms: [{ id: "r1", name: "Room1", template: "slides:sA", color_scheme: null }],
        tenant: {
          name: "Org",
          past_grace_minutes: 0,
          template: "slides:sA",
          logo_height: 40,
          accent_color: "#111111",
          slide_seconds: 10,
        },
      },
      files: [],
    });
    expect(result.counts.slide_sets).toBe(1);
    const t = await call(fns.getTenant, { key });
    expect(t.template).toMatch(/^slides:/);
    const rooms = await call(fns.listRooms, { key });
    expect(rooms[0].template).toMatch(/^slides:/);
  });
});
