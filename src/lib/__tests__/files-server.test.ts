import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocked backend: a tiny chainable fake of the Supabase query builder ----
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function fakeQuery(table: string) {
  const filters: [string, unknown][] = [];
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push([c, v]), q),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res),
  };
  return q;
}

vi.mock("@/lib/backend/admin.server", () => ({
  getBackendAdmin: async () => ({ from: (t: string) => fakeQuery(t) }),
}));

const unlocked = vi.fn(async () => true);
vi.mock("@/lib/tenant-auth.server", () => ({ isTenantUnlocked: () => unlocked() }));

import {
  assertTeamQuota,
  decodeBase64,
  extensionOf,
  fileAdminForRead,
  readFileToken,
  readZipToken,
  requireFileAdmin,
  signFileToken,
  signZipToken,
  tenantFileConfig,
} from "@/lib/files.server";
import { isTenantLockedError } from "@/lib/tenant-lock";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  unlocked.mockReset().mockResolvedValue(true);
  tables["tenants"] = [
    { id: "t1", key: "open", pin_hash: null, files_mode: null, max_upload_mb: null, team_quota_mb: 1, team_edit_locked: null },
    { id: "t2", key: "pinned", pin_hash: "x", files_mode: "download", max_upload_mb: 5, team_quota_mb: 0, team_edit_locked: true },
  ];
});

describe("download tokens", () => {
  it("round-trips a file token", async () => {
    const tok = await signFileToken({ k: "t1/a.pdf", n: "a.pdf", ct: "application/pdf" });
    expect(await readFileToken(tok)).toMatchObject({ k: "t1/a.pdf", n: "a.pdf" });
  });
  it("rejects tampered and expired tokens", async () => {
    const tok = await signFileToken({ k: "k", n: "n", ct: "c" });
    expect(await readFileToken(tok.slice(0, -2) + "xx")).toBeNull();
    expect(await readFileToken("garbage")).toBeNull();
    expect(await readFileToken(await signFileToken({ k: "k", n: "n", ct: "c" }, -1))).toBeNull();
  });
  it("zip token requires a tenant", async () => {
    expect(await readZipToken(await signZipToken({ t: "t1", ids: ["a"] }))).toMatchObject({ t: "t1", ids: ["a"] });
    expect(await readZipToken(await signZipToken({ t: "", ids: [] }))).toBeNull();
  });
});

describe("tenant file config", () => {
  it("applies defaults for missing values", async () => {
    expect(await tenantFileConfig("t1")).toEqual({
      id: "t1", filesMode: "full", maxUploadMb: 10, teamQuotaMb: 1, teamEditLocked: false,
    });
  });
  it("throws for unknown tenants", async () => {
    await expect(tenantFileConfig("nope")).rejects.toThrow("Unknown tenant");
    await expect(requireFileAdmin("nope")).rejects.toThrow("Unknown tenant key");
  });
});

describe("admin access", () => {
  it("allows tenants without PIN", async () => {
    expect((await requireFileAdmin("open")).id).toBe("t1");
    expect(unlocked).not.toHaveBeenCalled();
  });
  it("throws TENANT_LOCKED when the PIN session is missing", async () => {
    unlocked.mockResolvedValue(false);
    const err = await requireFileAdmin("pinned").catch((e) => e);
    expect(isTenantLockedError(err)).toBe(true);
  });
  it("read helper returns null instead of throwing when locked", async () => {
    unlocked.mockResolvedValue(false);
    expect(await fileAdminForRead("pinned")).toBeNull();
    await expect(fileAdminForRead("nope")).rejects.toThrow();
  });
  it("unlocked PIN tenant passes", async () => {
    expect((await requireFileAdmin("pinned")).filesMode).toBe("download");
  });
});

describe("team quota", () => {
  const MB = 1024 * 1024;
  it("ignores unlimited quota", async () => {
    await expect(assertTeamQuota(await tenantFileConfig("t2"), "team", 999 * MB)).resolves.toBeUndefined();
  });
  it("sums existing files and rejects overflow", async () => {
    tables["team_files"] = [
      { team_id: "a", size_bytes: 0.6 * MB },
      { team_id: "b", size_bytes: 0.9 * MB },
      { team_id: "a", size_bytes: null },
    ];
    const cfg = await tenantFileConfig("t1");
    await expect(assertTeamQuota(cfg, "a", 0.3 * MB)).resolves.toBeUndefined();
    await expect(assertTeamQuota(cfg, "a", 0.5 * MB)).rejects.toThrow("1 MB");
  });
});

describe("helpers", () => {
  it("decodes base64 and data URLs", () => {
    expect([...decodeBase64("data:x;base64,AQID")]).toEqual([1, 2, 3]);
  });
  it("normalizes extensions", () => {
    expect(extensionOf("A.PDF")).toBe("pdf");
    expect(extensionOf("noext")).toBe("");
  });
});
