import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fake backend bucket: an in-memory map behind the Cloud-style storage API.
const store = new Map<string, { bytes: Uint8Array; type: string }>();
const bucketApi = {
  upload: vi.fn(async (key: string, bytes: Uint8Array, o: { contentType: string }) => {
    store.set(key, { bytes, type: o.contentType });
    return { error: null };
  }),
  download: vi.fn(async (key: string) => {
    const f = store.get(key);
    return { data: f ? new Blob([f.bytes as BlobPart], { type: f.type }) : null };
  }),
  remove: vi.fn(async (keys: string[]) => {
    keys.forEach((k) => store.delete(k));
    return { error: null };
  }),
  list: vi.fn(async (prefix: string) => ({
    data: [...store.keys()].filter((k) => k.startsWith(prefix + "/")).map((k) => ({ name: k.slice(prefix.length + 1) })),
  })),
};
const from = vi.fn(() => bucketApi);
vi.mock("@/lib/backend/admin.server", () => ({
  getBackendAdmin: async () => ({ storage: { from } }),
}));

import { fileStorage, teamFileKey, tenantFileKey } from "../storage/index.server";
import { publishChange, subscribeChanges, onChangeInternal } from "../backend/events.server";

describe("file storage registry", () => {
  beforeEach(() => store.clear());
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips files through the backend bucket", async () => {
    const fs = fileStorage();
    expect(fs.name).toBe("backend");
    await fs.put("t/team/a/1.txt", new Uint8Array([1, 2]), "text/plain");
    expect(from).toHaveBeenCalledWith("tenant-files");
    const got = await fs.get("t/team/a/1.txt");
    expect(Array.from(got!.bytes)).toEqual([1, 2]);
    expect(got!.contentType).toContain("text/plain");
    expect(await fs.list("t/team/a")).toEqual([{ key: "t/team/a/1.txt" }]);
    await fs.remove(["t/team/a/1.txt"]);
    expect(await fs.get("t/team/a/1.txt")).toBeNull();
  });

  it("skips empty removals and never hands out direct URLs", async () => {
    const fs = fileStorage();
    bucketApi.remove.mockClear();
    await fs.remove([]);
    expect(bucketApi.remove).not.toHaveBeenCalled();
    expect(await fs.signedUrl("x", 60)).toBeNull();
  });

  it("surfaces upload errors", async () => {
    bucketApi.upload.mockResolvedValueOnce({ error: { message: "full" } } as never);
    await expect(fileStorage().put("k", new Uint8Array(), "a/b")).rejects.toThrow("full");
  });

  it("falls back to the backend for unknown providers", () => {
    vi.stubEnv("FILE_STORAGE", "Dropbox");
    expect(fileStorage().name).toBe("backend");
  });

  it("builds logical keys only", () => {
    expect(teamFileKey("t1", "tm", "pdf")).toMatch(/^t1\/team\/tm\/[0-9a-f-]{36}\.pdf$/);
    expect(tenantFileKey("t1", "")).toMatch(/^t1\/global\/[0-9a-f-]{36}$/);
  });
});

describe("change bus", () => {
  it("delivers to subscribers until they unsubscribe", () => {
    const l = vi.fn();
    const off = subscribeChanges(l);
    publishChange({ table: "teams", tenantId: "t" });
    off();
    publishChange({ table: "teams", tenantId: "t" });
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("keeps internal hooks and survives broken listeners", () => {
    const hook = vi.fn();
    onChangeInternal(hook);
    const off = subscribeChanges(() => {
      throw new Error("bad");
    });
    expect(() => publishChange({ table: "entries", tenantId: null })).not.toThrow();
    expect(hook).toHaveBeenCalledWith({ table: "entries", tenantId: null });
    off();
  });
});
