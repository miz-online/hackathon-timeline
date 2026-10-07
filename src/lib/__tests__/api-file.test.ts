import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

let local = true;
vi.mock("@/lib/backend/admin.server", () => ({ isLocalBackend: () => local }));

const readLocalFileToken = vi.fn();
const download = vi.fn();
vi.mock("@/lib/backend/local-storage.server", () => ({
  readLocalFileToken: (t: string) => readLocalFileToken(t),
  localStorageApi: () => ({ from: () => ({ download }) }),
}));

import { Route } from "@/routes/api/public/file";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;

beforeEach(() => {
  local = true;
  readLocalFileToken.mockReset();
  download.mockReset();
});

describe("file route (local backend)", () => {
  it("404 when not local backend", async () => {
    local = false;
    const res = await GET({ request: new Request("http://x/api/public/file?t=abc") });
    expect(res.status).toBe(404);
  });

  it("400 when token missing", async () => {
    const res = await GET({ request: new Request("http://x/api/public/file") });
    expect(res.status).toBe(400);
  });

  it("403 when token invalid", async () => {
    readLocalFileToken.mockResolvedValue(null);
    const res = await GET({ request: new Request("http://x/api/public/file?t=abc") });
    expect(res.status).toBe(403);
  });

  it("404 when download errors", async () => {
    readLocalFileToken.mockResolvedValue({ bucket: "b", path: "p" });
    download.mockResolvedValue({ data: null, error: { message: "nope" } });
    const res = await GET({ request: new Request("http://x/api/public/file?t=abc") });
    expect(res.status).toBe(404);
  });

  it("returns the file bytes", async () => {
    readLocalFileToken.mockResolvedValue({ bucket: "b", path: "p" });
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    download.mockResolvedValue({ data: blob, error: null });
    const res = await GET({ request: new Request("http://x/api/public/file?t=abc") });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
