import { describe, expect, it, vi } from "vitest";

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

let db: { from: (t: string) => unknown };
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => db }));
vi.mock("@/lib/tenant-auth.server", () => ({
  isTenantUnlocked: async () => true,
  markTenantUnlocked: async () => {},
  lockTenant: async () => {},
  verifyPin: async () => true,
  hashPin: async () => "h",
}));

function chain(resp: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "eq", "update"]) obj[m] = () => obj;
  obj.maybeSingle = () => Promise.resolve(resp);
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resp).then(res as never, rej as never);
  return obj;
}

const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

describe("tenant-auth.functions gaps", () => {
  it("surfaces the DB error when looking up a tenant by key", async () => {
    db = { from: () => chain({ data: null, error: { message: "db down" } }) };
    const fns = await import("@/lib/tenant-auth.functions");
    await expect(call(fns.getTenantAccess, { key: "k" })).rejects.toThrow("db down");
  });

  it("surfaces the DB error when updating a tenant's pin fails", async () => {
    db = {
      from: (table: string) =>
        table === "tenants"
          ? {
              select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "t1", pin_hash: null }, error: null }) }) }),
              update: () => ({ eq: () => Promise.resolve({ error: { message: "update failed" } }) }),
            }
          : chain({ data: null, error: null }),
    };
    const fns = await import("@/lib/tenant-auth.functions");
    await expect(call(fns.setTenantPin, { key: "k", newPin: "1234" })).rejects.toThrow("update failed");
  });
});
