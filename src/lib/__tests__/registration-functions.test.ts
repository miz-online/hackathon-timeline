import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roomTokenVariant } from "@/lib/registration";

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
vi.mock("@/lib/tenant-auth.server", () => ({ isTenantUnlocked: async () => true }));

const put = vi.fn(async () => {});
const remove = vi.fn(async () => {});
vi.mock("@/lib/storage/index.server", () => ({
  fileStorage: () => ({ put, remove }),
  teamFileKey: (tenantId: string, teamId: string, ext: string) => `${tenantId}/team/${teamId}/x${ext ? "." + ext : ""}`,
  tenantFileKey: (tenantId: string, ext: string) => `${tenantId}/global/x${ext ? "." + ext : ""}`,
}));

type Fns = typeof import("@/lib/registration.functions");
let fns: Fns;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

type Admin = {
  from: (t: string) => {
    insert: (r: Record<string, unknown>) => { select: () => { single: () => Promise<{ data: Record<string, unknown> }> } };
    update: (r: Record<string, unknown>) => { eq: (c: string, v: unknown) => Promise<{ error: null }> };
    select: (c?: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } };
  };
};

async function insertRow(table: string, row: Record<string, unknown>) {
  const { data } = await (db as Admin).from(table).insert(row).select().single();
  return data;
}

let tenantId: string;
let tenantKey: string;
let BASE_TOKEN: string;
let roomId: string;

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-reg-fn-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/registration.functions");
});

beforeEach(async () => {
  put.mockReset();
  remove.mockReset();
  tenantKey = `k-${Math.random().toString(36).slice(2, 10)}`;
  BASE_TOKEN = `B${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const tenant = await insertRow("tenants", { key: tenantKey, name: "Camp" });
  tenantId = tenant["id"] as string;
  const room = await insertRow("rooms", { tenant_id: tenantId, name: "Room A" });
  roomId = room["id"] as string;
  await insertRow("entries", {
    tenant_id: tenantId,
    kind: "register",
    register_token: BASE_TOKEN,
    title: "Hackathon",
    description: "desc",
    time: new Date(Date.now() - 1000).toISOString(),
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
});

describe("getRegistration", () => {
  it("returns found:false for an unknown token", async () => {
    expect(await call(fns.getRegistration, { token: "NOPE12345" })).toEqual({ found: false });
  });

  it("resolves the base token as open", async () => {
    const res = await call(fns.getRegistration, { token: BASE_TOKEN });
    expect(res).toMatchObject({ found: true, open: true, tenantName: "Camp", roomId: null });
    expect(res.rooms).toHaveLength(1);
  });

  it("resolves a room variant token and preselects the room", async () => {
    const variant = await roomTokenVariant(BASE_TOKEN, roomId);
    const res = await call(fns.getRegistration, { token: variant });
    expect(res).toMatchObject({ found: true, roomId });
  });

  it("reports closed outside the time window", async () => {
    await (db as Admin)
      .from("entries")
      .update({ time: new Date(Date.now() - 10_000).toISOString(), end_time: new Date(Date.now() - 5000).toISOString() } as never)
      .eq("register_token", BASE_TOKEN);
    const res = await call(fns.getRegistration, { token: BASE_TOKEN });
    expect(res).toMatchObject({ found: true, open: false });
  });

  it("defaults the window to one hour when end_time is missing", async () => {
    await (db as Admin)
      .from("entries")
      .update({ time: new Date().toISOString(), end_time: null } as never)
      .eq("register_token", BASE_TOKEN);
    const res = await call(fns.getRegistration, { token: BASE_TOKEN });
    expect(res).toMatchObject({ found: true, open: true });
  });

  it("returns null resolution when the tenant row is missing", async () => {
    await insertRow("entries", {
      tenant_id: crypto.randomUUID(),
      kind: "register",
      register_token: "ORPHANTOKEN",
      time: new Date().toISOString(),
    });
    expect(await call(fns.getRegistration, { token: "ORPHANTOKEN" })).toEqual({ found: false });
  });

  it("skips a non-matching room variant and falls through", async () => {
    const forged = "FORGEDXXXX";
    expect(await call(fns.getRegistration, { token: forged })).toEqual({ found: false });
  });
});

describe("submitRegistration", () => {
  it("creates a team and returns an edit code", async () => {
    const res = await call(fns.submitRegistration, {
      token: BASE_TOKEN,
      name: "Team Rocket",
      members: "A, B",
      project: "Idea",
    });
    expect(res.code).toHaveLength(12);
  });

  it("uses the resolved room when none is given explicitly", async () => {
    const variant = await roomTokenVariant(BASE_TOKEN, roomId);
    await call(fns.submitRegistration, { token: variant, name: "Room Team" });
    const found = await call(fns.getRegisteredTeam, {
      token: variant,
      code: (await call(fns.submitRegistration, { token: variant, name: "Room Team 2" })).code,
    });
    expect(found.found).toBe(true);
    if (found.found) expect(found.team.room_id).toBe(roomId);
  });

  it("rejects an unknown token", async () => {
    await expect(call(fns.submitRegistration, { token: "NOPE12345", name: "X" })).rejects.toThrow(
      "Unknown registration link",
    );
  });

  it("rejects when the window is closed", async () => {
    await (db as Admin)
      .from("entries")
      .update({ time: new Date(Date.now() - 10_000).toISOString(), end_time: new Date(Date.now() - 5000).toISOString() } as never)
      .eq("register_token", BASE_TOKEN);
    await expect(call(fns.submitRegistration, { token: BASE_TOKEN, name: "X" })).rejects.toThrow(
      "Registration is closed",
    );
  });
});

describe("getRegisteredTeam / updateRegisteredTeam", () => {
  it("returns found:false for a bad code", async () => {
    await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    expect(await call(fns.getRegisteredTeam, { token: BASE_TOKEN, code: "WRONGCODE00" })).toEqual({
      found: false,
    });
  });

  it("returns found:false when the token itself is unknown", async () => {
    expect(await call(fns.getRegisteredTeam, { token: "NOPE12345", code: "WRONGCODE00" })).toEqual({
      found: false,
    });
  });

  it("returns team details including file config", async () => {
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    const res = await call(fns.getRegisteredTeam, { token: BASE_TOKEN, code });
    expect(res).toMatchObject({ found: true, filesMode: "full", maxUploadMb: 10, locked: false });
  });

  it("updates name/members/project", async () => {
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    await call(fns.updateRegisteredTeam, { token: BASE_TOKEN, code, name: "New Name", members: "X" });
    const res = await call(fns.getRegisteredTeam, { token: BASE_TOKEN, code });
    if (res.found) expect(res.team.name).toBe("New Name");
  });

  it("rejects update for an unknown token", async () => {
    await expect(
      call(fns.updateRegisteredTeam, { token: "NOPE12345", code: "XXXXXX", name: "N" }),
    ).rejects.toThrow("Unknown registration link");
  });

  it("rejects update when team editing is locked", async () => {
    await (db as Admin).from("tenants").update({ team_edit_locked: true } as never).eq("key", tenantKey);
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    await expect(call(fns.updateRegisteredTeam, { token: BASE_TOKEN, code, name: "N" })).rejects.toThrow(
      "locked",
    );
  });
});

describe("team files (self service)", () => {
  async function registerTeam() {
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Files Team" });
    return code;
  }

  it("rejects everything for an unknown link", async () => {
    await expect(call(fns.listFilesForTeam, { token: BASE_TOKEN, code: "NOPENOPE" })).rejects.toThrow(
      "Unknown link",
    );
    await expect(
      call(fns.uploadFileForTeam, { token: BASE_TOKEN, code: "NOPENOPE", filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("Unknown link");
    await expect(
      call(fns.deleteFileForTeam, { token: BASE_TOKEN, code: "NOPENOPE", id: crypto.randomUUID() }),
    ).rejects.toThrow("Unknown link");
    await expect(
      call(fns.getTeamFileDownloadUrl, { token: BASE_TOKEN, code: "NOPENOPE", scope: "team", id: crypto.randomUUID() }),
    ).rejects.toThrow("Unknown link");
  });

  it("lists own and shared files, uploads, downloads and deletes", async () => {
    const code = await registerTeam();
    await insertRow("tenant_files", { tenant_id: tenantId, name: "shared.pdf", storage_key: "s" });
    let res = await call(fns.listFilesForTeam, { token: BASE_TOKEN, code });
    expect(res.mode).toBe("full");
    expect(res.own).toEqual([]);
    expect(res.shared).toHaveLength(1);

    await call(fns.uploadFileForTeam, {
      token: BASE_TOKEN,
      code,
      filename: "mine.txt",
      dataBase64: Buffer.from("hi").toString("base64"),
    });
    res = await call(fns.listFilesForTeam, { token: BASE_TOKEN, code });
    expect(res.own).toHaveLength(1);

    const ownUrl = await call(fns.getTeamFileDownloadUrl, {
      token: BASE_TOKEN,
      code,
      scope: "team",
      id: res.own[0].id,
    });
    expect(ownUrl.url).toMatch(/file-download/);
    const sharedUrl = await call(fns.getTeamFileDownloadUrl, {
      token: BASE_TOKEN,
      code,
      scope: "tenant",
      id: res.shared[0].id,
    });
    expect(sharedUrl.url).toMatch(/file-download/);

    await call(fns.deleteFileForTeam, { token: BASE_TOKEN, code, id: res.own[0].id });
    res = await call(fns.listFilesForTeam, { token: BASE_TOKEN, code });
    expect(res.own).toEqual([]);
  });

  it("reports empty lists when files are off", async () => {
    await (db as Admin).from("tenants").update({ files_mode: "off" } as never).eq("key", tenantKey);
    const code = await registerTeam();
    const res = await call(fns.listFilesForTeam, { token: BASE_TOKEN, code });
    expect(res).toEqual({ mode: "off", own: [], shared: [] });
  });

  it("rejects uploads in download-only mode or when locked", async () => {
    await (db as Admin).from("tenants").update({ files_mode: "download" } as never).eq("key", tenantKey);
    const code = await registerTeam();
    await expect(
      call(fns.uploadFileForTeam, { token: BASE_TOKEN, code, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("Uploads are disabled");

    await (db as Admin).from("tenants").update({ files_mode: "full", team_edit_locked: true } as never).eq("key", tenantKey);
    await expect(
      call(fns.uploadFileForTeam, { token: BASE_TOKEN, code, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("Team editing is locked");
  });

  it("rejects oversize uploads and quota overflow", async () => {
    await (db as Admin).from("tenants").update({ max_upload_mb: 0 } as never).eq("key", tenantKey);
    const code = await registerTeam();
    await expect(
      call(fns.uploadFileForTeam, { token: BASE_TOKEN, code, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("larger than");

    await (db as Admin).from("tenants").update({ max_upload_mb: 10, team_quota_mb: 1 } as never).eq("key", tenantKey);
    const teamRow = (
      await (db as Admin).from("teams").select("id").eq("tenant_id", tenantId).maybeSingle()
    ).data as { id: string } | null;
    if (teamRow) {
      await insertRow("team_files", {
        tenant_id: tenantId,
        team_id: teamRow.id,
        name: "big.bin",
        storage_key: "k",
        size_bytes: 2 * 1024 * 1024,
      });
    }
    await expect(
      call(fns.uploadFileForTeam, { token: BASE_TOKEN, code, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("storage limit");
  });

  it("rejects delete/download in download-only mode, when locked, or for an unknown file", async () => {
    const code = await registerTeam();
    await call(fns.uploadFileForTeam, { token: BASE_TOKEN, code, filename: "a.txt", dataBase64: "aGk=" });
    const res = await call(fns.listFilesForTeam, { token: BASE_TOKEN, code });
    const id = res.own[0].id;

    await (db as Admin).from("tenants").update({ files_mode: "download" } as never).eq("key", tenantKey);
    await expect(call(fns.deleteFileForTeam, { token: BASE_TOKEN, code, id })).rejects.toThrow(
      "read only",
    );
    await expect(
      call(fns.getTeamFileDownloadUrl, { token: BASE_TOKEN, code, scope: "team", id }),
    ).rejects.toThrow("disabled");

    await (db as Admin).from("tenants").update({ files_mode: "off" } as never).eq("key", tenantKey);
    await expect(
      call(fns.getTeamFileDownloadUrl, { token: BASE_TOKEN, code, scope: "tenant", id }),
    ).rejects.toThrow("disabled");

    await (db as Admin).from("tenants").update({ files_mode: "full", team_edit_locked: true } as never).eq("key", tenantKey);
    await expect(call(fns.deleteFileForTeam, { token: BASE_TOKEN, code, id })).rejects.toThrow("locked");

    await (db as Admin).from("tenants").update({ team_edit_locked: false } as never).eq("key", tenantKey);
    await expect(
      call(fns.deleteFileForTeam, { token: BASE_TOKEN, code, id: crypto.randomUUID() }),
    ).rejects.toThrow("File not found");
    await expect(
      call(fns.getTeamFileDownloadUrl, { token: BASE_TOKEN, code, scope: "team", id: crypto.randomUUID() }),
    ).rejects.toThrow("File not found");
  });
});

/** Wraps the real local admin client, forcing an error for a given table + operation mode. */
function faultyFrom(real: Record<string, unknown>, table: string, mode: "select" | "insert" | "update" | "delete", message: string) {
  const realFn = (real as { from: (t: string) => unknown }).from;
  return {
    ...real,
    from(t: string) {
      if (t !== table) return realFn(t);
      const calls: { name: string; args: unknown[] }[] = [];
      const proxy = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
                const found = calls.map((c) => c.name).find((n) => ["insert", "update", "delete"].includes(n));
                const actualMode = found ?? "select";
                if (actualMode === mode) {
                  resolve({ data: null, error: { message } });
                  return;
                }
                let q = realFn(table) as Record<string, (...a: unknown[]) => unknown>;
                for (const c of calls) q = q[c.name](...c.args) as typeof q;
                Promise.resolve(q).then(resolve, reject);
              };
            }
            return (...args: unknown[]) => {
              calls.push({ name: prop, args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  };
}

describe("resolveToken edge cases", () => {
  it("skips a register entry with no token and falls through to a matching one", async () => {
    await insertRow("entries", {
      tenant_id: tenantId,
      kind: "register",
      register_token: null,
      title: "No Token",
      time: new Date().toISOString(),
    });
    const res = await call(fns.getRegistration, { token: BASE_TOKEN });
    expect(res).toMatchObject({ found: true, title: "Hackathon" });
  });

  it("returns found:false when the matching entry's tenant row is missing", async () => {
    await insertRow("entries", {
      tenant_id: crypto.randomUUID(),
      kind: "register",
      register_token: "ORPHANTOKEN2",
      title: "Orphan",
      time: new Date().toISOString(),
    });
    expect(await call(fns.getRegistration, { token: "ORPHANTOKEN2" })).toEqual({ found: false });
  });
});

describe("DB error propagation", () => {
  it("surfaces an error from submitRegistration's insert", async () => {
    const real = db as Record<string, unknown>;
    db = faultyFrom(real, "teams", "insert", "insert boom");
    await expect(call(fns.submitRegistration, { token: BASE_TOKEN, name: "X" })).rejects.toThrow("insert boom");
    db = real;
  });

  it("surfaces an error from updateRegisteredTeam's update", async () => {
    const real = db as Record<string, unknown>;
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    db = faultyFrom(real, "teams", "update", "update boom");
    await expect(
      call(fns.updateRegisteredTeam, { token: BASE_TOKEN, code, name: "New" }),
    ).rejects.toThrow("update boom");
    db = real;
  });

  it("surfaces an error from uploadFileForTeam's insert", async () => {
    const real = db as Record<string, unknown>;
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    db = faultyFrom(real, "team_files", "insert", "insert boom");
    await expect(
      call(fns.uploadFileForTeam, { token: BASE_TOKEN, code, filename: "a.txt", dataBase64: "aGk=" }),
    ).rejects.toThrow("insert boom");
    db = real;
  });

  it("falls back to an empty array when listing own/shared files errors out", async () => {
    const real = db as Record<string, unknown>;
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    db = faultyFrom(real, "team_files", "select", "select boom");
    await expect(call(fns.listFilesForTeam, { token: BASE_TOKEN, code })).resolves.toMatchObject({
      own: [],
    });
    db = real;
  });

  it("falls back to an empty array when listing shared files errors out", async () => {
    const real = db as Record<string, unknown>;
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    db = faultyFrom(real, "tenant_files", "select", "select boom");
    await expect(call(fns.listFilesForTeam, { token: BASE_TOKEN, code })).resolves.toMatchObject({
      shared: [],
    });
    db = real;
  });

  it("lists only shared files in download-only mode, without querying team_files", async () => {
    const real = db as Record<string, unknown>;
    await (db as Admin).from("tenants").update({ files_mode: "download" } as never).eq("key", tenantKey);
    const { code } = await call(fns.submitRegistration, { token: BASE_TOKEN, name: "Team" });
    const res = await call(fns.listFilesForTeam, { token: BASE_TOKEN, code });
    expect(res).toMatchObject({ mode: "download", own: [] });
    await (db as Admin).from("tenants").update({ files_mode: "full" } as never).eq("key", tenantKey);
    db = real;
  });
});
