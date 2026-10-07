import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("local-storage gaps", () => {
  const prev = process.env["SESSION_SECRET"];
  beforeEach(() => {
    process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-storage-gaps-"));
  });
  afterEach(() => {
    if (prev === undefined) delete process.env["SESSION_SECRET"];
    else process.env["SESSION_SECRET"] = prev;
    vi.resetModules();
  });

  it("falls back to the dev secret when SESSION_SECRET is unset", async () => {
    delete process.env["SESSION_SECRET"];
    vi.resetModules();
    const { createLocalFileToken, readLocalFileToken } = await import("@/lib/backend/local-storage.server");
    const tok = await createLocalFileToken("b", "p", 60);
    expect(await readLocalFileToken(tok)).toEqual({ bucket: "b", path: "p" });
  });

  it("rejects a path that normalizes outside the bucket root via a sibling prefix", async () => {
    vi.resetModules();
    const { localStorageApi } = await import("@/lib/backend/local-storage.server");
    const bucket = localStorageApi().from("tenant-files");
    await expect(bucket.upload("..sneaky/x.txt".replace("..sneaky", "../tenant-files-evil"), new Uint8Array([1]))).rejects.toThrow(
      "Invalid path",
    );
  });

  it("accepts a raw ArrayBuffer body", async () => {
    vi.resetModules();
    const { localStorageApi } = await import("@/lib/backend/local-storage.server");
    const bucket = localStorageApi().from("tenant-files");
    const buf = new Uint8Array([1, 2, 3]).buffer;
    await bucket.upload("t1/raw.bin", buf);
    const dl = await bucket.download("t1/raw.bin");
    expect(new Uint8Array(await dl.data!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("local-scheduler default fallbacks", () => {
  let changeListener: ((e: { table: string; tenantId: string | null }) => void) | null = null;
  beforeEach(() => {
    changeListener = null;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses default grace/practice minutes and skips non-finite notified_at-free entries past grace", async () => {
    const tenants = [{ id: "t1" }];
    const now = Date.now();
    const dbStub = {
      prepare(sql: string) {
        return {
          all(...args: unknown[]) {
            if (sql.includes("from tenants t")) return tenants;
            if (sql.startsWith("select count(*) as c from teams")) return [{ c: 0 }];
            if (sql.includes("from entries")) {
              return [
                { id: "e1", kind: "entry", time: new Date(now + 1000).toISOString(), notified_at: null, notified_teams: "[]" },
              ];
            }
            throw new Error(`unexpected sql: ${sql}`);
          },
        };
      },
    };
    vi.doMock("../backend/sqlite-db.server", () => ({ getDb: vi.fn(async () => dbStub) }));
    vi.doMock("../backend/events.server", () => ({ onChangeInternal: vi.fn((cb: any) => { changeListener = cb; }) }));
    vi.resetModules();
    const { runLocalRpc } = await import("../backend/local-scheduler.server");
    const res = await runLocalRpc("next_webhook_dispatch_at");
    expect(res.data).toBe(new Date(now + 1000).toISOString());
  });
});
