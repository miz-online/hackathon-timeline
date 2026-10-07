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
let real: Record<string, unknown>;
let key: string;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

/** Wraps the real local admin client, forcing an error for a given table + operation mode. */
function faultyFrom(table: string, mode: "select" | "insert" | "update" | "delete", message: string) {
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

/** Wraps the real local admin client, forcing a storage.upload() failure for a given bucket. */
function faultyStorageUpload(bucket: string, message: string) {
  const realStorage = (real as { storage: { from: (b: string) => Record<string, unknown> } }).storage;
  return {
    ...real,
    storage: {
      from(b: string) {
        const rb = realStorage.from(b) as Record<string, (...a: unknown[]) => unknown>;
        if (b !== bucket) return rb;
        return { ...rb, upload: async () => ({ error: { message } }) };
      },
    },
  };
}

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-admin-err-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  real = createLocalClient() as unknown as Record<string, unknown>;
  db = real;
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  db = real;
  key = (await call(fns.createTenant, {})).key;
});

describe("faulty admin client — list/update error paths", () => {
  it("listColorSchemes / upsertColorScheme / deleteColorScheme surface DB errors", async () => {
    const scheme = await call(fns.upsertColorScheme, { key, scheme: { name: "Red", color: "#ff0000" } });
    db = faultyFrom("color_schemes", "select", "select boom");
    await expect(call(fns.listColorSchemes, { key })).rejects.toThrow("select boom");
    db = faultyFrom("color_schemes", "update", "update boom");
    await expect(
      call(fns.upsertColorScheme, { key, scheme: { id: scheme.id, name: "Red2", color: "#00ff00" } }),
    ).rejects.toThrow("update boom");
    db = faultyFrom("color_schemes", "insert", "insert boom");
    await expect(call(fns.upsertColorScheme, { key, scheme: { name: "New", color: "#000000" } })).rejects.toThrow(
      "insert boom",
    );
    db = faultyFrom("color_schemes", "delete", "delete boom");
    await expect(call(fns.deleteColorScheme, { key, id: scheme.id })).rejects.toThrow("delete boom");
  });

  it("listSlideSets / upsertSlideSet / deleteSlideSet surface DB errors", async () => {
    const set = await call(fns.upsertSlideSet, { key, set: { name: "Set" } });
    db = faultyFrom("slide_sets", "select", "select boom");
    await expect(call(fns.listSlideSets, { key })).rejects.toThrow("select boom");
    db = faultyFrom("slide_sets", "update", "update boom");
    await expect(
      call(fns.upsertSlideSet, { key, set: { id: set.id, name: "Set2", slide_seconds: 10 } }),
    ).rejects.toThrow("update boom");
    db = faultyFrom("slide_sets", "insert", "insert boom");
    await expect(call(fns.upsertSlideSet, { key, set: { name: "Another" } })).rejects.toThrow("insert boom");
    db = faultyFrom("slide_sets", "delete", "delete boom");
    await expect(call(fns.deleteSlideSet, { key, id: set.id })).rejects.toThrow("delete boom");
  });

  it("listSlides / uploadSlide / addEntriesSlide / updateSlide / moveSlide / deleteSlide surface DB errors", async () => {
    const set = await call(fns.upsertSlideSet, { key, set: { name: "Set" } });
    const png = Buffer.from("hi").toString("base64");
    const slide = await call(fns.uploadSlide, {
      key,
      setId: set.id,
      filename: "a.png",
      contentType: "image/png",
      dataBase64: png,
    });
    db = faultyFrom("slides", "select", "select boom");
    await expect(call(fns.listSlides, { key, setId: set.id })).rejects.toThrow("select boom");
    db = faultyFrom("slides", "insert", "insert boom");
    await expect(
      call(fns.uploadSlide, { key, setId: set.id, filename: "b.png", contentType: "image/png", dataBase64: png }),
    ).rejects.toThrow("insert boom");
    await expect(call(fns.addEntriesSlide, { key, setId: set.id, name: "Timeline" })).rejects.toThrow("insert boom");
    db = faultyFrom("slides", "update", "update boom");
    await expect(call(fns.updateSlide, { key, id: slide.id, name: "Renamed" })).rejects.toThrow("update boom");
    db = faultyFrom("slides", "delete", "delete boom");
    await expect(call(fns.deleteSlide, { key, id: slide.id })).rejects.toThrow("delete boom");
  });

  it("uploadTenantLogo / removeTenantLogo surface storage and DB errors", async () => {
    const png = Buffer.from("hi").toString("base64");
    db = faultyStorageUpload("tenant-logos", "storage boom");
    await expect(
      call(fns.uploadTenantLogo, { key, filename: "a.png", contentType: "image/png", dataBase64: png }),
    ).rejects.toThrow("storage boom");
    db = real;
    await call(fns.uploadTenantLogo, { key, filename: "a.png", contentType: "image/png", dataBase64: png });
    db = faultyFrom("tenants", "update", "tenants boom");
    await expect(
      call(fns.uploadTenantLogo, { key, filename: "b.png", contentType: "image/png", dataBase64: png }),
    ).rejects.toThrow("tenants boom");
    await expect(call(fns.removeTenantLogo, { key })).rejects.toThrow("tenants boom");
  });
});
