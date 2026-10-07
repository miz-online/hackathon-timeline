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
vi.mock("@tanstack/react-start/server", () => ({ setResponseHeader: vi.fn() }));

vi.mock("@/lib/backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {} }));
vi.mock("../backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {} }));
vi.mock("../backend/local-storage.server", () => ({ localStorageApi: () => ({}) }));
let db: unknown;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => db, isLocalBackend: () => true }));

const unlocked = vi.fn(async (_id: string) => true);
const markUnlocked = vi.fn(async (_id: string) => {});
const lockTenant = vi.fn(async (_id: string) => {});
vi.mock("@/lib/tenant-auth.server", () => ({
  isTenantUnlocked: (id: string) => unlocked(id),
  markTenantUnlocked: (id: string) => markUnlocked(id),
  lockTenant: (id: string) => lockTenant(id),
  verifyPin: async (pin: string, hash: string | null) => hash === `h:${pin}`,
  hashPin: async (p: string) => `h:${p}`,
}));

type Fns = typeof import("@/lib/tenant-auth.functions");
let fns: Fns;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

async function makeTenant(pin?: string) {
  const pin_hash = pin ? `h:${pin}` : null;
  const row = (db as { from: (t: string) => { insert: (r: unknown) => { select: () => { single: () => Promise<{ data: { id: string; key: string } }> } } } })
    .from("tenants")
    .insert({ key: `k-${Math.random().toString(36).slice(2, 10)}`, pin_hash })
    .select();
  const { data } = await row.single();
  return data;
}

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-tenant-auth-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/tenant-auth.functions");
});

beforeEach(() => {
  unlocked.mockReset().mockResolvedValue(true);
  markUnlocked.mockReset();
  lockTenant.mockReset();
});

describe("getTenantAccess", () => {
  it("reports unprotected tenants as unlocked without a session check", async () => {
    const t = await makeTenant();
    const res = await call(fns.getTenantAccess, { key: t.key });
    expect(res).toEqual({ protected: false, unlocked: true });
    expect(unlocked).not.toHaveBeenCalled();
  });
  it("reports protected tenants via the session", async () => {
    const t = await makeTenant("1234");
    unlocked.mockResolvedValue(false);
    expect(await call(fns.getTenantAccess, { key: t.key })).toEqual({ protected: true, unlocked: false });
  });
  it("throws for unknown tenant keys", async () => {
    await expect(call(fns.getTenantAccess, { key: "nope" })).rejects.toThrow("Unknown tenant key");
  });
});

describe("unlockTenantAccess", () => {
  it("unlocks unprotected tenants immediately", async () => {
    const t = await makeTenant();
    expect(await call(fns.unlockTenantAccess, { key: t.key, pin: "whatever" })).toEqual({ ok: true });
  });
  it("accepts the right PIN and marks the session unlocked", async () => {
    const t = await makeTenant("4321");
    expect(await call(fns.unlockTenantAccess, { key: t.key, pin: "4321" })).toEqual({ ok: true });
    expect(markUnlocked).toHaveBeenCalledWith(t.id);
  });
  it("rejects the wrong PIN", async () => {
    const t = await makeTenant("4321");
    expect(await call(fns.unlockTenantAccess, { key: t.key, pin: "0000" })).toEqual({ ok: false });
    expect(markUnlocked).not.toHaveBeenCalled();
  });
});

describe("lockTenantAccess", () => {
  it("locks the tenant", async () => {
    const t = await makeTenant("1234");
    expect(await call(fns.lockTenantAccess, { key: t.key })).toEqual({ ok: true });
    expect(lockTenant).toHaveBeenCalledWith(t.id);
  });
});

describe("setTenantPin", () => {
  it("sets a first PIN without requiring a current one", async () => {
    const t = await makeTenant();
    const res = await call(fns.setTenantPin, { key: t.key, newPin: "9999" });
    expect(res).toEqual({ protected: true });
    expect(markUnlocked).toHaveBeenCalledWith(t.id);
  });
  it("requires the current PIN unless already unlocked", async () => {
    const t = await makeTenant("1234");
    unlocked.mockResolvedValue(false);
    await expect(call(fns.setTenantPin, { key: t.key, newPin: "5555" })).rejects.toThrow("Invalid PIN");
    await expect(
      call(fns.setTenantPin, { key: t.key, currentPin: "wrong", newPin: "5555" }),
    ).rejects.toThrow("Invalid PIN");
    const res = await call(fns.setTenantPin, { key: t.key, currentPin: "1234", newPin: "5555" });
    expect(res).toEqual({ protected: true });
  });
  it("allows changing when already unlocked without a current PIN", async () => {
    const t = await makeTenant("1234");
    unlocked.mockResolvedValue(true);
    const res = await call(fns.setTenantPin, { key: t.key, newPin: "5555" });
    expect(res).toEqual({ protected: true });
  });
  it("clears the PIN and locks the tenant when newPin is blank", async () => {
    const t = await makeTenant("1234");
    const res = await call(fns.setTenantPin, { key: t.key, currentPin: "1234", newPin: "   " });
    expect(res).toEqual({ protected: false });
    expect(lockTenant).toHaveBeenCalledWith(t.id);
  });
});
