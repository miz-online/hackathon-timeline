import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: unknown) => opts }));

const readZipToken = vi.fn();
vi.mock("@/lib/files.server", () => ({ readZipToken: (t: string) => readZipToken(t) }));

const get = vi.fn();
vi.mock("@/lib/storage/index.server", () => ({ fileStorage: () => ({ get }) }));

type Resp = { data: unknown; error: unknown };
function chain(resp: Resp) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) obj[m] = () => obj;
  obj.then = (res: unknown, rej: unknown) => Promise.resolve(resp).then(res as never, rej as never);
  return obj;
}
let admin: { from: (t: string) => unknown };
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => admin }));

import { Route } from "@/routes/api/public/files-zip";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route as any).server.handlers.GET;
const req = () => new Request("http://x/api/public/files-zip?t=a");

beforeEach(() => {
  readZipToken.mockReset();
  get.mockReset();
});

describe("files-zip route gaps", () => {
  it("404 when team_files select returns undefined data", async () => {
    readZipToken.mockResolvedValue({ t: "ten1", ids: [], exp: 0 });
    admin = { from: () => chain({ data: undefined, error: null }) };
    const res = await GET({ request: req() });
    expect(res.status).toBe(404);
  });

  it("falls back to default team folder name when teamRows select returns undefined data", async () => {
    readZipToken.mockResolvedValue({ t: "ten1", ids: ["f1"], exp: 0 });
    admin = {
      from: (table: string) =>
        table === "team_files"
          ? chain({ data: [{ id: "f1", name: "a.txt", storage_key: "k1", team_id: "team1" }], error: null })
          : chain({ data: undefined, error: null }),
    };
    get.mockResolvedValue({ bytes: new TextEncoder().encode("x"), contentType: "text/plain" });
    const res = await GET({ request: req() });
    expect(res.status).toBe(200);
  });
});
