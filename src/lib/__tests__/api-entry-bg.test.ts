import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

type Resp = { data: unknown; error: unknown };
function chain(resp: Resp) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) obj[m] = () => obj;
  obj.maybeSingle = () => Promise.resolve(resp);
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resp).then(res as never, rej as never);
  return obj;
}

function makeAdmin(opts: {
  tenant?: Resp;
  entry?: Resp;
  download?: { data: Blob | null; error: unknown };
}) {
  return {
    from: (table: string) => {
      if (table === "tenants") return chain(opts.tenant ?? { data: null, error: null });
      if (table === "entries") return chain(opts.entry ?? { data: null, error: null });
      return chain({ data: null, error: null });
    },
    storage: {
      from: () => ({
        download: async () => opts.download ?? { data: null, error: { message: "nope" } },
      }),
    },
  };
}

let admin: ReturnType<typeof makeAdmin>;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => admin }));

import { Route } from "@/routes/api/public/entry-bg.$tenantKey.$entryId";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;

const req = () => new Request("http://x/api/public/entry-bg/acme/e1");

describe("entry-bg route", () => {
  it("404 when tenant missing", async () => {
    admin = makeAdmin({ tenant: { data: null, error: null } });
    const res = await GET({ params: { tenantKey: "acme", entryId: "e1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when entry has no background_path", async () => {
    admin = makeAdmin({
      tenant: { data: { id: "t1" }, error: null },
      entry: { data: { background_path: null, background_content_type: null }, error: null },
    });
    const res = await GET({ params: { tenantKey: "acme", entryId: "e1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when storage download fails", async () => {
    admin = makeAdmin({
      tenant: { data: { id: "t1" }, error: null },
      entry: { data: { background_path: "p.png", background_content_type: null }, error: null },
      download: { data: null, error: { message: "missing" } },
    });
    const res = await GET({ params: { tenantKey: "acme", entryId: "e1" }, request: req() });
    expect(res.status).toBe(404);
  });

  it("returns image bytes with explicit content type", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    admin = makeAdmin({
      tenant: { data: { id: "t1" }, error: null },
      entry: { data: { background_path: "p.png", background_content_type: "image/webp" }, error: null },
      download: { data: blob, error: null },
    });
    const res = await GET({ params: { tenantKey: "acme", entryId: "e1" }, request: req() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("falls back to blob type then default content type", async () => {
    const blob = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    admin = makeAdmin({
      tenant: { data: { id: "t1" }, error: null },
      entry: { data: { background_path: "p.png", background_content_type: null }, error: null },
      download: { data: blob, error: null },
    });
    const res = await GET({ params: { tenantKey: "acme", entryId: "e1" }, request: req() });
    expect(res.headers.get("content-type")).toBe("image/jpeg");

    const blobNoType = new Blob([new Uint8Array([1])]);
    admin = makeAdmin({
      tenant: { data: { id: "t1" }, error: null },
      entry: { data: { background_path: "p.png", background_content_type: null }, error: null },
      download: { data: blobNoType, error: null },
    });
    const res2 = await GET({ params: { tenantKey: "acme", entryId: "e1" }, request: req() });
    expect(res2.headers.get("content-type")).toBe("image/png");
  });
});
