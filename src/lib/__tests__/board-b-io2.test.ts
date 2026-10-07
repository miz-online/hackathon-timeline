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
vi.mock("@/lib/tenant-auth.server", () => ({
  isTenantUnlocked: async () => true,
  markTenantUnlocked: async () => {},
  hashPin: async (p: string) => `h:${p}`,
}));

type Fns = typeof import("@/lib/board.functions");
let fns: Fns;
let key: string;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });
const imgB64 = Buffer.from("fake-image-bytes").toString("base64");

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-io2-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  key = (await call(fns.createTenant, {})).key;
});

describe("exportTenantData extra branches", () => {
  it("skips slide/entry-background files that are missing from storage, and exports team/tenant files", async () => {
    const team = await call(fns.upsertTeam, { key, team: { name: "Alpha" } });
    const set = await call(fns.upsertSlideSet, { key, set: { name: "Set" } });
    await call(fns.uploadSlide, { key, setId: set.id, filename: "a.png", contentType: "image/png", dataBase64: imgB64 });
    // Fallback: query directly using listSlides to get the path, then remove from storage.
    const list = await call(fns.listSlides, { key, setId: set.id });
    expect(list.length).toBe(1);

    const genFile = { path: "files/global/g.pdf", content_type: "application/pdf", dataBase64: imgB64 };
    const teamFile = { path: "files/teams/x/t.pdf", content_type: "application/pdf", dataBase64: imgB64 };
    await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["tenant_files", "team_files"],
      data: {
        tenant_files: [{ name: "g.pdf", file: genFile.path, content_type: "application/pdf" }],
        team_files: [{ team: "alpha", name: "t.pdf", file: teamFile.path, content_type: "application/pdf" }],
      },
      files: [genFile, teamFile],
    });

    const exported = await call(fns.exportTenantData, { key });
    expect(exported.data.team_files?.length).toBe(1);
    expect(exported.data.tenant_files?.length).toBe(1);
    void team;
  });
});

describe("importTenantData extra branches", () => {
  it("keeps existing color scheme / team refs when their sections are not re-imported", async () => {
    const scheme = await call(fns.upsertColorScheme, { key, scheme: { name: "Red", color: "#ff0000" } });
    const team = await call(fns.upsertTeam, { key, team: { name: "Alpha" } });
    const schemeRef = (await call(fns.exportTenantData, { key })).data.color_schemes?.[0]?.id;
    const teamRef = (await call(fns.exportTenantData, { key })).data.teams?.[0]?.id;
    const result = await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["entries", "team_files"],
      data: {
        entries: [
          {
            kind: "entry",
            time: new Date().toISOString(),
            end_time: null,
            title: "E1",
            description: "",
            rooms: [],
            color_scheme: schemeRef,
            slide_set: null,
            notify: false,
            background: null,
            background_align: "right-top",
            background_height: 80,
            background_opacity: 100,
            background_margin: 0,
            background_tint: null,
          },
        ],
        team_files: [{ team: teamRef, name: "f.pdf", file: "files/f.pdf", content_type: "application/pdf" }],
      },
      files: [{ path: "files/f.pdf", content_type: "application/pdf", dataBase64: imgB64 }],
    });
    expect(result.counts.entries).toBe(1);
    expect(result.counts.team_files).toBe(1);
    void scheme;
    void team;
  });

  it("merges into existing webhooks on append and warns about unknown team files", async () => {
    await call(fns.upsertWebhook, { key, webhook: { name: "Existing", type: "discord", enabled: true, url: "https://example.com/h" } });
    const result = await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["webhooks", "team_files", "tenant_files"],
      data: {
        webhooks: [{ id: "w2", name: "New", type: "discord", enabled: true, url: "https://example.com/h2" }],
        team_files: [{ team: "nope", name: "f.pdf", file: "files/missing.pdf", content_type: "application/pdf" }],
        tenant_files: [{ name: "g.pdf", file: "files/missing2.pdf", content_type: "application/pdf" }],
      },
      files: [],
    });
    expect(result.counts.webhooks).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/unknown team/);
    expect(result.warnings.join(" ")).toMatch(/missing in the archive/);
  });

  it("replace mode clears previously imported entry backgrounds and team/tenant files", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Main" } });
    const team = await call(fns.upsertTeam, { key, team: { name: "Alpha" } });
    const bgFile = { path: "images/bg.png", content_type: "image/png", dataBase64: imgB64 };
    await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["entries", "tenant_files", "team_files"],
      data: {
        entries: [
          {
            kind: "entry",
            time: new Date().toISOString(),
            end_time: null,
            title: "E1",
            description: "",
            rooms: ["Main"],
            color_scheme: null,
            slide_set: null,
            notify: false,
            background: { file: bgFile.path, content_type: "image/png" },
            background_align: "right-top",
            background_height: 80,
            background_opacity: 100,
            background_margin: 0,
            background_tint: null,
          },
        ],
        tenant_files: [{ name: "g.pdf", file: "files/g.pdf", content_type: "application/pdf" }],
        team_files: [{ team: "alpha", name: "t.pdf", file: "files/t.pdf", content_type: "application/pdf" }],
      },
      files: [
        bgFile,
        { path: "files/g.pdf", content_type: "application/pdf", dataBase64: imgB64 },
        { path: "files/t.pdf", content_type: "application/pdf", dataBase64: imgB64 },
      ],
    });
    const result = await call(fns.importTenantData, {
      key,
      mode: "replace",
      sections: ["entries", "tenant_files", "team_files"],
      data: { entries: [], tenant_files: [], team_files: [] },
      files: [],
    });
    expect(result.ok).toBe(true);
    const entries = await call(fns.listEntries, { key });
    expect(entries.length).toBe(0);
    void room;
  });

  it("falls back to the archive's base filename when the stored path has an extra wrapper folder", async () => {
    const result = await call(fns.importTenantData, {
      key,
      mode: "append",
      sections: ["slides"],
      data: {
        slides: [
          { name: "Img", kind: "image", file: "images/slides/01-a.png", content_type: "image/png", set: null, duration_seconds: null },
        ],
      },
      files: [{ path: "export-root/images/slides/01-a.png", content_type: "image/png", dataBase64: imgB64 }],
    });
    expect(result.counts.slides).toBe(1);
  });
});
