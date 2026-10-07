import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

type Resp = { data: unknown; error: unknown };
function chain(resp: Resp) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "eq", "order", "limit"]) obj[m] = () => obj;
  obj.maybeSingle = () => Promise.resolve(resp);
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resp).then(res as never, rej as never);
  return obj;
}

let admin: { from: (t: string) => unknown; storage: unknown };
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => admin }));

import { Route } from "@/routes/api/public/slide.$tenantKey.$slideId";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;
const req = () => new Request("http://x/api/public/slide/acme/s1");

function build(tenant: Resp, slide?: Resp, download?: { data: Blob | null; error: unknown }) {
  admin = {
    from: (table: string) => (table === "tenants" ? chain(tenant) : chain(slide ?? { data: null, error: null })),
    storage: { from: () => ({ download: async () => download ?? { data: null, error: { message: "x" } } }) },
  };
}

describe("slide route", () => {
  it("404 when tenant missing", async () => {
    build({ data: null, error: null });
    const res = await GET({ params: { tenantKey: "acme", slideId: "s1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when slide missing", async () => {
    build({ data: { id: "t1" }, error: null }, { data: null, error: null });
    const res = await GET({ params: { tenantKey: "acme", slideId: "s1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when download fails", async () => {
    build(
      { data: { id: "t1" }, error: null },
      { data: { path: "p.png", content_type: "image/png" }, error: null },
      { data: null, error: { message: "nope" } },
    );
    const res = await GET({ params: { tenantKey: "acme", slideId: "s1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("returns image with slide content type", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    build(
      { data: { id: "t1" }, error: null },
      { data: { path: "p.png", content_type: "image/webp" }, error: null },
      { data: blob, error: null },
    );
    const res = await GET({ params: { tenantKey: "acme", slideId: "s1" }, request: req() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
  });

  it("falls back to blob type then default", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    build(
      { data: { id: "t1" }, error: null },
      { data: { path: "p.png", content_type: null }, error: null },
      { data: blob, error: null },
    );
    const res = await GET({ params: { tenantKey: "acme", slideId: "s1" }, request: req() });
    expect(res.headers.get("content-type")).toBe("image/jpeg");

    const blobNoType = new Blob([new Uint8Array([1])]);
    build(
      { data: { id: "t1" }, error: null },
      { data: { path: "p.png", content_type: null }, error: null },
      { data: blobNoType, error: null },
    );
    const res2 = await GET({ params: { tenantKey: "acme", slideId: "s1" }, request: req() });
    expect(res2.headers.get("content-type")).toBe("image/png");
  });
});
