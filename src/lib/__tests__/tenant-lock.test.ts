import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTenantLockedError,
  onTenantLocked,
  runTenantAdminQuery,
  TenantLockedError,
} from "@/lib/tenant-lock";

// Minimal browser window stand-in so the lock broadcast can be observed.
function fakeWindow() {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  return target;
}

afterEach(() => vi.unstubAllGlobals());

describe("tenant lock", () => {
  it("recognises the lock error in any shape", () => {
    expect(isTenantLockedError(new TenantLockedError())).toBe(true);
    expect(isTenantLockedError(new Error("x TENANT_LOCKED y"))).toBe(true);
    expect(isTenantLockedError("TENANT_LOCKED")).toBe(true);
    expect(isTenantLockedError(new Error("other"))).toBe(false);
    expect(isTenantLockedError(null)).toBe(false);
    expect(new TenantLockedError().statusCode).toBe(401);
  });

  it("admin queries return data normally", async () => {
    expect(await runTenantAdminQuery(async () => [1, 2])).toEqual([1, 2]);
  });

  it("locked queries return null and broadcast to the UI", async () => {
    fakeWindow();
    const handler = vi.fn();
    const off = onTenantLocked(handler);
    expect(await runTenantAdminQuery(async () => { throw new TenantLockedError(); })).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    await runTenantAdminQuery(async () => { throw new TenantLockedError(); });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("other errors still surface", async () => {
    await expect(runTenantAdminQuery(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });

  it("is a no-op on the server", async () => {
    expect(onTenantLocked(() => {})).toBeTypeOf("function");
    expect(await runTenantAdminQuery(async () => { throw new TenantLockedError(); })).toBeNull();
  });
});
