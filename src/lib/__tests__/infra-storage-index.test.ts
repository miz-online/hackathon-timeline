import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const admin = {
  storage: {
    from: vi.fn(),
  },
};

vi.mock("@/lib/backend/admin.server", () => ({
  getBackendAdmin: vi.fn(async () => admin),
}));

import { fileStorage, teamFileKey, tenantFileKey } from "../storage/index.server";

describe("storage/index.server", () => {
  let bucket: any;
  beforeEach(() => {
    bucket = {
      upload: vi.fn(async () => ({ error: null })),
      download: vi.fn(async () => ({ data: null })),
      remove: vi.fn(async () => ({})),
      list: vi.fn(async () => ({ data: null })),
    };
    admin.storage.from.mockReturnValue(bucket);
  });

  afterEach(() => {
    delete process.env["FILE_STORAGE"];
    vi.clearAllMocks();
  });

  it("defaults to the backend provider and unknown ids fall back to it too", async () => {
    expect(fileStorage().name).toBe("backend");
    process.env["FILE_STORAGE"] = "nope";
    expect(fileStorage().name).toBe("backend");
    process.env["FILE_STORAGE"] = "CLOUD";
    expect(fileStorage().name).toBe("backend");
    process.env["FILE_STORAGE"] = "local";
    expect(fileStorage().name).toBe("backend");
  });

  it("put throws on upload error", async () => {
    bucket.upload.mockResolvedValueOnce({ error: { message: "nope" } });
    await expect(fileStorage().put("k", new Uint8Array([1]), "text/plain")).rejects.toThrow("nope");
    expect(bucket.upload).toHaveBeenCalledWith("k", new Uint8Array([1]), { contentType: "text/plain", upsert: true });
  });

  it("get returns null when the object is missing", async () => {
    expect(await fileStorage().get("missing")).toBeNull();
  });

  it("get returns bytes and content type, defaulting the type when blank", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    bucket.download.mockResolvedValueOnce({ data: blob });
    const out = await fileStorage().get("k");
    expect(out?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(out?.contentType).toBe("application/octet-stream");
  });

  it("remove is a no-op for an empty key list and otherwise delegates", async () => {
    await fileStorage().remove([]);
    expect(bucket.remove).not.toHaveBeenCalled();
    await fileStorage().remove(["a", "b"]);
    expect(bucket.remove).toHaveBeenCalledWith(["a", "b"]);
  });

  it("list maps names onto prefixed keys, defaulting a null result to []", async () => {
    expect(await fileStorage().list("pre")).toEqual([]);
    bucket.list.mockResolvedValueOnce({ data: [{ name: "a.txt" }] });
    expect(await fileStorage().list("pre")).toEqual([{ key: "pre/a.txt" }]);
  });

  it("signedUrl always streams through our own route", async () => {
    expect(await fileStorage().signedUrl("k", 60)).toBeNull();
  });

  it("builds logical keys for team and tenant files, with and without an extension", () => {
    expect(teamFileKey("t1", "team1", "pdf")).toMatch(/^t1\/team\/team1\/[0-9a-f-]{36}\.pdf$/);
    expect(teamFileKey("t1", "team1", "")).toMatch(/^t1\/team\/team1\/[0-9a-f-]{36}$/);
    expect(tenantFileKey("t1", "zip")).toMatch(/^t1\/global\/[0-9a-f-]{36}\.zip$/);
    expect(tenantFileKey("t1", "")).toMatch(/^t1\/global\/[0-9a-f-]{36}$/);
  });
});
