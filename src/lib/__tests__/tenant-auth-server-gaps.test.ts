import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionData: { data: Record<string, unknown> } = { data: {} };
const update = vi.fn(async (next: Record<string, unknown>) => {
  Object.assign(sessionData.data, next);
});
const clear = vi.fn(async () => {
  sessionData.data = {};
});
const useSession = vi.fn(async () => ({ data: sessionData.data, update, clear }));

vi.mock("@tanstack/react-start/server", () => ({ useSession: (...a: unknown[]) => useSession(...a) }));

describe("tenant-auth.server session plumbing", () => {
  const originalSecret = process.env["SESSION_SECRET"];

  beforeEach(() => {
    vi.resetModules();
    sessionData.data = {};
    update.mockClear();
    clear.mockClear();
    useSession.mockClear();
    process.env["SESSION_SECRET"] = "test-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env["SESSION_SECRET"];
    else process.env["SESSION_SECRET"] = originalSecret;
  });

  it("throws when SESSION_SECRET is not set", async () => {
    delete process.env["SESSION_SECRET"];
    const mod = await import("@/lib/tenant-auth.server");
    await expect(mod.markTenantUnlocked("t1")).rejects.toThrow("SESSION_SECRET is not set");
  });

  it("caches the derived session key across calls with the same secret", async () => {
    const mod = await import("@/lib/tenant-auth.server");
    await mod.markTenantUnlocked("t1");
    await mod.markTenantUnlocked("t2");
    const [cfg1] = useSession.mock.calls[0]!;
    const [cfg2] = useSession.mock.calls[1]!;
    expect((cfg1 as { password: string }).password).toBe((cfg2 as { password: string }).password);
  });

  it("marks a tenant unlocked, adds only once, and isTenantUnlocked reflects it", async () => {
    const mod = await import("@/lib/tenant-auth.server");
    await mod.markTenantUnlocked("t1");
    await mod.markTenantUnlocked("t1");
    expect(sessionData.data["tenants"]).toEqual(["t1"]);
    expect(await mod.isTenantUnlocked("t1")).toBe(true);
    expect(await mod.isTenantUnlocked("other")).toBe(false);
  });

  it("lockTenant removes a tenant and clears the session once empty", async () => {
    const mod = await import("@/lib/tenant-auth.server");
    await mod.markTenantUnlocked("t1");
    await mod.markTenantUnlocked("t2");
    await mod.lockTenant("t1");
    expect(sessionData.data["tenants"]).toEqual(["t2"]);
    await mod.lockTenant("t2");
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
