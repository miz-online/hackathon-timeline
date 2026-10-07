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
const imgB64 = Buffer.from("fake-image-bytes").toString("base64");

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-io-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  unlocked.mockReset().mockResolvedValue(true);
  key = (await call(fns.createTenant, {})).key;
});

async function seedTenant() {
  const scheme = await call(fns.upsertColorScheme, { key, scheme: { name: "Red", color: "#ff0000" } });
  const room = await call(fns.upsertRoom, { key, room: { name: "Main", ref_id: "main", color_scheme_id: scheme.id } });
  const team = await call(fns.upsertTeam, { key, team: { name: "Alpha", room_id: room.id } });
  const set = await call(fns.upsertSlideSet, { key, set: { name: "Set" } });
  await call(fns.uploadSlide, { key, setId: set.id, filename: "a.png", contentType: "image/png", dataBase64: imgB64 });
  await call(fns.addEntriesSlide, { key, setId: set.id, name: "Timeline" });
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
  await call(fns.uploadEntryBackground, {
    key,
    entryId: (await call(fns.listEntries, { key }))[0].id,
    filename: "bg.png",
    contentType: "image/png",
    dataBase64: imgB64,
  }).catch(() => {});
  await call(fns.uploadTenantLogo, { key, filename: "logo.png", contentType: "image/png", dataBase64: imgB64 });
  const webhook = await call(fns.upsertWebhook, { key, webhook: { name: "WH", type: "discord", enabled: true, url: "https://example.com/hook" } });
  // There is no upsertTenantFile/upsertTeamFile server fn, so seed files via importTenantData itself.
  const genFile = { path: "files/global/general.pdf", content_type: "application/pdf", dataBase64: imgB64 };
  const teamFile = { path: "files/teams/team/team.pdf", content_type: "application/pdf", dataBase64: imgB64 };
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
  return { scheme, room, team, set, webhook };
}

describe("exportTenantData / importTenantData", () => {
  it("round-trips an export back into a fresh tenant (replace mode)", async () => {
    await seedTenant();
    const exported = await call(fns.exportTenantData, { key });
    expect(exported.data.rooms?.length).toBeGreaterThan(0);
    expect(exported.data.color_schemes?.length).toBe(1);
    expect(exported.data.slides?.some((s) => s.kind === "entries")).toBe(true);
    expect(exported.data.logo).toBeTruthy();
    expect(exported.files.length).toBeGreaterThan(0);

    const target = (await call(fns.createTenant, {})).key;
    const result = await call(fns.importTenantData, {
      key: target,
      mode: "replace",
      sections: [
        "tenant",
        "color_schemes",
        "rooms",
        "teams",
        "entries",
        "slide_sets",
        "slides",
        "webhooks",
        "team_files",
        "tenant_files",
        "logo",
      ],
      data: exported.data,
      files: exported.files,
    });
    expect(result.ok).toBe(true);
    expect(result.counts.rooms).toBe(1);
    expect(result.counts.color_schemes).toBe(1);
    expect(result.counts.teams).toBe(1);
    expect(result.counts.slide_sets).toBe(1);
    expect(result.counts.slides).toBeGreaterThan(0);

    const rooms = await call(fns.listRooms, { key: target });
    expect(rooms.map((r) => r.name)).toEqual(["Main"]);
    const tTenant = await call(fns.getTenant, { key: target });
    expect(tTenant.logo_url).toBeTruthy();

    // second import in append mode onto the same tenant just adds more rows
    const appendResult = await call(fns.importTenantData, {
      key: target,
      mode: "append",
      sections: ["rooms"],
      data: { rooms: [{ id: "extra", name: "Extra Room", template: null, color_scheme: null }] },
      files: [],
    });
    expect(appendResult.counts.rooms).toBe(1);
    const rooms2 = await call(fns.listRooms, { key: target });
    expect(rooms2.map((r) => r.name).sort()).toEqual(["Extra Room", "Main"]);
  });

  it("warns about missing references and files without throwing", async () => {
    const target = key;
    const result = await call(fns.importTenantData, {
      key: target,
      mode: "replace",
      sections: ["rooms", "teams", "entries", "slide_sets", "slides", "webhooks", "team_files", "tenant_files", "logo"],
      data: {
        rooms: [{ id: "r1", name: "Room1", template: "slides:unknown-set", color_scheme: "missing-scheme" }],
        teams: [{ id: "t1", name: "Team1", members: "", project: "", room: "missing-room" }],
        entries: [
          {
            kind: "entry",
            time: new Date().toISOString(),
            end_time: null,
            title: "E1",
            description: "",
            rooms: ["missing-room"],
            color_scheme: "missing-scheme",
            slide_set: null,
            notify: true,
            background: { file: "images/missing.png", content_type: "image/png" },
            background_align: "right-top",
            background_height: 80,
            background_opacity: 100,
            background_margin: 0,
            background_tint: null,
          },
        ],
        slide_sets: [],
        slides: [{ name: "Missing image", kind: "image", file: "images/missing.png", content_type: "image/png", set: "unknown-set", duration_seconds: null }],
        webhooks: [{ id: "w1", name: "WH", type: "discord", enabled: true, url: null }],
        team_files: [{ team: "missing-team", name: "f.pdf", file: "files/missing.pdf", content_type: "application/pdf" }],
        tenant_files: [{ name: "f.pdf", file: "files/missing.pdf", content_type: "application/pdf" }],
        logo: { file: "images/missing.png", content_type: "image/png" },
      },
      files: [],
    });
    expect(result.warnings.length).toBeGreaterThan(5);
    expect(result.warnings.join(" ")).toMatch(/unknown color scheme/);
    expect(result.warnings.join(" ")).toMatch(/unknown room/);
    expect(result.warnings.join(" ")).toMatch(/background file/);
    expect(result.warnings.join(" ")).toMatch(/missing in the archive/);
    expect(result.warnings.join(" ")).toMatch(/imported without URL/);
    expect(result.counts.rooms).toBe(1);
    expect(result.counts.teams).toBe(1);
    expect(result.counts.webhooks).toBe(1);
  });

  it("creates a default slide set on import when slides exist without one", async () => {
    const file = { path: "images/slides/01-a.png", content_type: "image/png", dataBase64: imgB64 };
    const result = await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["slides"],
      data: {
        slides: [{ name: "Img", kind: "image", file: file.path, content_type: "image/png", set: null, duration_seconds: null }],
      },
      files: [file],
    });
    expect(result.counts.slides).toBe(1);
    const sets = await call(fns.listSlideSets, { key });
    expect(sets.some((s) => s.ref_id === "slides")).toBe(true);
  });
});
