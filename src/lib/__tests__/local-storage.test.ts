import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createLocalFileToken,
  localStorageApi,
  readLocalFileToken,
} from "@/lib/backend/local-storage.server";

// Real filesystem, isolated in a throwaway directory per run.
beforeAll(() => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-storage-"));
});

const bucket = () => localStorageApi().from("tenant-files");

describe("local file storage", () => {
  it("uploads, lists, downloads and removes", async () => {
    await bucket().upload("t1/team/a/x.txt", new TextEncoder().encode("hello"));
    await bucket().upload("t1/team/a/y.bin", new Blob([new Uint8Array([1, 2])]));
    const list = await bucket().list("t1/team/a");
    expect(list.data.map((e) => e.name).sort()).toEqual(["x.txt", "y.bin"]);
    const dl = await bucket().download("t1/team/a/x.txt");
    expect(await dl.data!.text()).toBe("hello");
    await bucket().remove(["t1/team/a/x.txt", "does/not/exist"]);
    expect((await bucket().download("t1/team/a/x.txt")).error).toEqual({ message: "Object not found" });
  });

  it("listing a missing folder is empty, not an error", async () => {
    expect(await bucket().list("nothing/here")).toEqual({ data: [], error: null });
  });

  it("blocks path traversal", async () => {
    await expect(bucket().upload("../../escape.txt", new Uint8Array([1]))).rejects.toThrow("Invalid path");
  });

  it("keeps buckets separate", async () => {
    await localStorageApi().from("tenant-logos").upload("t1/logo.png", new Uint8Array([9]));
    expect((await bucket().download("t1/logo.png")).data).toBeNull();
  });
});

describe("local signed URLs", () => {
  it("round-trips bucket and path", async () => {
    const tok = await createLocalFileToken("tenant-ads", "t1/a.png", 60);
    expect(await readLocalFileToken(tok)).toEqual({ bucket: "tenant-ads", path: "t1/a.png" });
  });

  it("rejects expired or forged tokens", async () => {
    expect(await readLocalFileToken(await createLocalFileToken("b", "p", -1))).toBeNull();
    const tok = await createLocalFileToken("b", "p", 60);
    const [payload] = tok.split(".");
    expect(await readLocalFileToken(`${payload}.forged`)).toBeNull();
    expect(await readLocalFileToken("nodot")).toBeNull();
  });

  it("signed URLs point at our own download route", async () => {
    const { data } = await bucket().createSignedUrl("t1/x.txt");
    expect(data.signedUrl).toMatch(/^\/api\/public\/file\?t=/);
    const many = await bucket().createSignedUrls(["a", "b"]);
    expect(many.data.map((d) => d.path)).toEqual(["a", "b"]);
  });
});
