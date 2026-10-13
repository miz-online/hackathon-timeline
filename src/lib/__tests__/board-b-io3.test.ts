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
const failTables = new Set<string>();
let failUploads = false;
const boom = { message: "boom" };
function failing(): unknown {
  const q: Record<string, unknown> = {};
  const self = new Proxy(q, {
    get(_t, p) {
      if (p === "then") return (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: boom }).then(r);
      return () => self;
    },
  });
  return self;
}
function wrap(real: any) {
  return new Proxy(real, {
    get(o, p) {
      if (p === "from")
        return (t: string) => {
          const q = o.from(t);
          if (!failTables.has(t)) return q;
          return new Proxy(q, { get: (qo, qp) => (qp === "insert" ? () => failing() : (qo as any)[qp]) });
        };
      if (p === "storage")
        return {
          from: (b: string) => {
            const bucket = o.storage.from(b);
            return new Proxy(bucket, {
              get: (bo, bp) =>
                bp === "upload" && failUploads
                  ? async () => ({ data: null, error: boom })
                  : typeof (bo as any)[bp] === "function"
                    ? (bo as any)[bp].bind(bo)
                    : (bo as any)[bp],
            });
          },
        };
      return o[p];
    },
  });
}
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
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-io3-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = wrap(createLocalClient());
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

const ALL = ["tenant","color_schemes","rooms","teams","entries","slide_sets","slides","webhooks","team_files","tenant_files","logo"];

describe("importTenantData failure warnings", () => {
  it("collects warnings when inserts fail", async () => {
    await seedTenant();
    const exported = await call(fns.exportTenantData, { key });
    const target = (await call(fns.createTenant, {})).key;
    for (const t of ["rooms", "teams", "webhooks", "slide_sets", "slides"]) failTables.add(t);
    try {
      const result = await call(fns.importTenantData, { key: target, mode: "replace", sections: ALL, data: exported.data, files: exported.files });
      const w = result.warnings.join("\n");
      expect(w).toMatch(/Room "Main" not imported: boom/);
      expect(w).toMatch(/Team "Alpha" not imported: boom/);
      expect(w).toMatch(/Webhook "WH" not imported: boom/);
      expect(w).toMatch(/Slide set "Set" not imported: boom/);
      expect(w).toMatch(/no slide set available/);
    } finally {
      failTables.clear();
    }
  });

  it("collects warnings when slide inserts and uploads fail", async () => {
    await seedTenant();
    const exported = await call(fns.exportTenantData, { key });
    const t1 = (await call(fns.createTenant, {})).key;
    failTables.add("slides");
    try {
      const r = await call(fns.importTenantData, { key: t1, mode: "replace", sections: ["slide_sets", "slides"], data: exported.data, files: exported.files });
      expect(r.warnings.join("\n")).toMatch(/Slide ".*" not imported: boom/);
    } finally {
      failTables.clear();
    }
    const t2 = (await call(fns.createTenant, {})).key;
    failUploads = true;
    try {
      const r = await call(fns.importTenantData, { key: t2, mode: "replace", sections: ALL, data: exported.data, files: exported.files });
      const w = r.warnings.join("\n");
      expect(w).toMatch(/upload failed/);
      expect(w).toMatch(/Logo: upload failed — boom/);
    } finally {
      failUploads = false;
    }
  });
});
