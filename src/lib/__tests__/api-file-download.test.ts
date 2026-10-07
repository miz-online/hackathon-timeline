import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

const readFileToken = vi.fn();
vi.mock("@/lib/files.server", () => ({ readFileToken: (t: string) => readFileToken(t) }));

const get = vi.fn();
vi.mock("@/lib/storage/index.server", () => ({ fileStorage: () => ({ get }) }));

import { Route } from "@/routes/api/public/file-download";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;

beforeEach(() => {
  readFileToken.mockReset();
  get.mockReset();
});

describe("file-download route", () => {
  it("400 when token missing", async () => {
    const res = await GET({ request: new Request("http://x/api/public/file-download") });
    expect(res.status).toBe(400);
  });

  it("403 when token invalid", async () => {
    readFileToken.mockResolvedValue(null);
    const res = await GET({ request: new Request("http://x/api/public/file-download?t=a") });
    expect(res.status).toBe(403);
  });

  it("404 when object missing", async () => {
    readFileToken.mockResolvedValue({ k: "key", n: "f.txt", ct: "", exp: 0 });
    get.mockResolvedValue(null);
    const res = await GET({ request: new Request("http://x/api/public/file-download?t=a") });
    expect(res.status).toBe(404);
  });

  it("streams the file with a sanitized filename and explicit content type", async () => {
    readFileToken.mockResolvedValue({ k: "key", n: 'weird"name\r\n.txt', ct: "text/plain", exp: 0 });
    get.mockResolvedValue({ bytes: new Uint8Array([1, 2]), contentType: "application/octet-stream" });
    const res = await GET({ request: new Request("http://x/api/public/file-download?t=a") });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="weird_name__.txt"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("falls back to object content type when token has none", async () => {
    readFileToken.mockResolvedValue({ k: "key", n: "f.txt", ct: "", exp: 0 });
    get.mockResolvedValue({ bytes: new Uint8Array([1]), contentType: "application/pdf" });
    const res = await GET({ request: new Request("http://x/api/public/file-download?t=a") });
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });
});
