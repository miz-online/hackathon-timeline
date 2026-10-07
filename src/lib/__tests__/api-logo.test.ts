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

import { Route } from "@/routes/api/public/logo.$tenantKey";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;
const req = () => new Request("http://x/api/public/logo/acme");

function build(tenant: Resp, download?: { data: Blob | null; error: unknown }) {
  admin = {
    from: () => chain(tenant),
    storage: { from: () => ({ download: async () => download ?? { data: null, error: { message: "x" } } }) },
  };
}

describe("logo route", () => {
  it("404 when tenant has no logo_url", async () => {
    build({ data: { logo_url: null }, error: null });
    const res = await GET({ params: { tenantKey: "acme" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when tenant missing entirely", async () => {
    build({ data: null, error: null });
    const res = await GET({ params: { tenantKey: "acme" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when download fails", async () => {
    build({ data: { logo_url: "logo.png" }, error: null }, { data: null, error: { message: "nope" } });
    const res = await GET({ params: { tenantKey: "acme" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("returns image with blob type", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "image/svg+xml" });
    build({ data: { logo_url: "logo.png" }, error: null }, { data: blob, error: null });
    const res = await GET({ params: { tenantKey: "acme" }, request: req() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toContain("max-age=60");
  });

  it("falls back to default content type when blob has none", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    build({ data: { logo_url: "logo.png" }, error: null }, { data: blob, error: null });
    const res = await GET({ params: { tenantKey: "acme" }, request: req() });
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});
