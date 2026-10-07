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
vi.mock("../backend/local-storage.server", () => ({ localStorageApi: () => ({}) }));
let db: unknown;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => db, isLocalBackend: () => true }));

const unlocked = vi.fn(async () => true);
vi.mock("@/lib/tenant-auth.server", () => ({ isTenantUnlocked: () => unlocked() }));

const put = vi.fn(async () => {});
const remove = vi.fn(async () => {});
vi.mock("@/lib/storage/index.server", () => ({
  fileStorage: () => ({ put, remove }),
  teamFileKey: (tenantId: string, teamId: string, ext: string) => `${tenantId}/team/${teamId}/x${ext ? "." + ext : ""}`,
  tenantFileKey: (tenantId: string, ext: string) => `${tenantId}/global/x${ext ? "." + ext : ""}`,
}));

type Fns = typeof import("@/lib/files.functions");
let fns: Fns;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

type Admin = {
  from: (t: string) => {
    insert: (r: Record<string, unknown>) => { select: () => { single: () => Promise<{ data: Record<string, unknown> }> } };
  };
};

async function insertRow(table: string, row: Record<string, unknown>) {
  const { data } = await (db as Admin).from(table).insert(row).select().single();
  return data;
}

let tenantId: string;
let tenantKey: string;
let teamId: string;

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-files-fn-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/files.functions");
});

beforeEach(async () => {
  unlocked.mockReset().mockResolvedValue(true);
  put.mockReset();
  remove.mockReset();
  tenantKey = `k-${Math.random().toString(36).slice(2, 10)}`;
  const tenant = await insertRow("tenants", { key: tenantKey });
  tenantId = tenant["id"] as string;
  const team = await insertRow("teams", { tenant_id: tenantId, name: "Alpha" });
  teamId = team["id"] as string;
});

describe("team files", () => {
  it("lists empty, uploads, lists, deletes", async () => {
    expect(await call(fns.listTeamFiles, { key: tenantKey, teamId })).toEqual([]);
    await call(fns.uploadTeamFile, {
      key: tenantKey,
      teamId,
      filename: "a.pdf",
      dataBase64: Buffer.from("hello").toString("base64"),
    });
    expect(put).toHaveBeenCalledTimes(1);
    const list = await call(fns.listTeamFiles, { key: tenantKey, teamId });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("a.pdf");
    await call(fns.deleteTeamFile, { key: tenantKey, id: list[0].id });
    expect(remove).toHaveBeenCalledWith([expect.stringContaining("team")]);
    expect(await call(fns.listTeamFiles, { key: tenantKey, teamId })).toEqual([]);
  });

  it("rejects deleting an unknown file", async () => {
    await expect(call(fns.deleteTeamFile, { key: tenantKey, id: crypto.randomUUID() })).rejects.toThrow(
      "File not found",
    );
  });

  it("rejects uploads when files are off, or oversize, or over quota", async () => {
    await (db as Admin).from("tenants").insert({ key: "off", files_mode: "off" } as never);
    await expect(
      call(fns.uploadTeamFile, { key: "off", teamId, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("disabled");

    await (db as Admin)
      .from("tenants")
      .insert({ key: "small", max_upload_mb: 0 } as never);
    await expect(
      call(fns.uploadTeamFile, { key: "small", teamId, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("larger than");

    await (db as Admin).from("tenants").insert({ key: "quota", team_quota_mb: 1 } as never);
    type SelectAdmin = { from: (t: string) => { select: () => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: { id: string } }> } } } };
    const quotaTenant = (
      await (db as SelectAdmin).from("tenants").select().eq("key", "quota").maybeSingle()
    ).data;
    const bigTeam = await insertRow("teams", { tenant_id: quotaTenant.id, name: "Big" });
    await insertRow("team_files", {
      tenant_id: quotaTenant.id,
      team_id: bigTeam["id"],
      name: "big.bin",
      storage_key: "k",
      size_bytes: 2 * 1024 * 1024,
    });
    await expect(
      call(fns.uploadTeamFile, {
        key: "quota",
        teamId: bigTeam["id"] as string,
        filename: "a.txt",
        dataBase64: "aGk=",
      }),
    ).rejects.toThrow("storage limit");
  });
});

describe("tenant files", () => {
  it("uploads, lists, renames, deletes", async () => {
    await call(fns.uploadTenantFile, {
      key: tenantKey,
      filename: "logo.png",
      dataBase64: Buffer.from("png").toString("base64"),
    });
    const list = await call(fns.listTenantFiles, { key: tenantKey });
    expect(list).toHaveLength(1);
    await call(fns.renameTenantFile, { key: tenantKey, id: list[0].id, name: "  renamed.png  " });
    const renamed = await call(fns.listTenantFiles, { key: tenantKey });
    expect(renamed[0].name).toBe("renamed.png");
    await call(fns.deleteTenantFile, { key: tenantKey, id: list[0].id });
    expect(await call(fns.listTenantFiles, { key: tenantKey })).toEqual([]);
  });

  it("rejects deleting an unknown tenant file", async () => {
    await expect(
      call(fns.deleteTenantFile, { key: tenantKey, id: crypto.randomUUID() }),
    ).rejects.toThrow("File not found");
  });

  it("read helpers return [] while locked", async () => {
    await (db as Admin).from("tenants").insert({ key: "pinned", pin_hash: "x" } as never);
    unlocked.mockResolvedValue(false);
    expect(await call(fns.listTenantFiles, { key: "pinned" })).toEqual([]);
    expect(await call(fns.listAllTeamFiles, { key: "pinned" })).toEqual([]);
  });
});

describe("getFileDownloadUrl", () => {
  it("signs a URL for a team or tenant scoped file", async () => {
    await call(fns.uploadTeamFile, {
      key: tenantKey,
      teamId,
      filename: "a.pdf",
      dataBase64: "aGk=",
    });
    const list = await call(fns.listTeamFiles, { key: tenantKey, teamId });
    const res = await call(fns.getFileDownloadUrl, { key: tenantKey, scope: "team", id: list[0].id });
    expect(res.url).toMatch(/^\/api\/public\/file-download\?t=/);
  });
  it("rejects an unknown file id", async () => {
    await expect(
      call(fns.getFileDownloadUrl, { key: tenantKey, scope: "tenant", id: crypto.randomUUID() }),
    ).rejects.toThrow("File not found");
  });
});

describe("listAllTeamFiles", () => {
  it("tags rows with team names and sorts by team order then name", async () => {
    const teamB = await insertRow("teams", { tenant_id: tenantId, name: "Beta", sort_order: 1 });
    await call(fns.uploadTeamFile, { key: tenantKey, teamId, filename: "z.txt", dataBase64: "aGk=" });
    await call(fns.uploadTeamFile, {
      key: tenantKey,
      teamId: teamB["id"] as string,
      filename: "a.txt",
      dataBase64: "aGk=",
    });
    const rows = await call(fns.listAllTeamFiles, { key: tenantKey });
    expect(rows.map((r) => r.tag)).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to an em dash for an orphaned team_id", async () => {
    // team_id references a team that was never created (and never will be),
    // simulating a dangling reference without relying on FK cascade deletes.
    await insertRow("team_files", {
      tenant_id: tenantId,
      team_id: crypto.randomUUID(),
      name: "orphan.txt",
      storage_key: "k",
    });
    const rows = await call(fns.listAllTeamFiles, { key: tenantKey });
    expect(rows.find((r) => r.name === "orphan.txt")?.tag).toBe("—");
  });

  it("renames a team file", async () => {
    await call(fns.uploadTeamFile, { key: tenantKey, teamId, filename: "old.txt", dataBase64: "aGk=" });
    const list = await call(fns.listTeamFiles, { key: tenantKey, teamId });
    await call(fns.renameTeamFile, { key: tenantKey, id: list[0].id, name: "new.txt" });
    const renamed = await call(fns.listTeamFiles, { key: tenantKey, teamId });
    expect(renamed[0].name).toBe("new.txt");
  });
});

describe("getTeamFilesZipUrl", () => {
  it("signs a zip URL", async () => {
    const res = await call(fns.getTeamFilesZipUrl, { key: tenantKey, ids: [] });
    expect(res.url).toMatch(/^\/api\/public\/files-zip\?t=/);
  });
});

describe("getTeamSelfUrl", () => {
  it("fails for unknown team", async () => {
    await expect(
      call(fns.getTeamSelfUrl, { key: tenantKey, teamId: crypto.randomUUID() }),
    ).rejects.toThrow("Unknown team");
  });

  it("reports no-token when there is no registration entry", async () => {
    expect(await call(fns.getTeamSelfUrl, { key: tenantKey, teamId })).toEqual({ reason: "no-token" });
  });

  it("creates an edit code on demand and prefers the room-tagged entry", async () => {
    const room = await insertRow("rooms", { tenant_id: tenantId, name: "Room A" });
    const token = `S${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    await insertRow("entries", {
      tenant_id: tenantId,
      kind: "register",
      register_token: token,
      title: "T",
      description: "",
      time: new Date().toISOString(),
      tags: [room["id"] as string],
    });
    await (db as Admin)
      .from("teams")
      .insert({ tenant_id: tenantId, name: "Z" } as never); // unrelated noise row
    const res = (await call(fns.getTeamSelfUrl, { key: tenantKey, teamId })) as { path: string };
    expect(res.path).toMatch(new RegExp(`^/tr/${token}/`));

    // Calling again reuses the now-persisted edit code (no second insert error).
    const res2 = (await call(fns.getTeamSelfUrl, { key: tenantKey, teamId })) as { path: string };
    expect(res2.path).toBe(res.path);
  });
});
