import { describe, expect, it, vi, beforeEach } from "vitest";
import { unzipSync } from "fflate";

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

describe("files-zip route", () => {
  it("400 when token missing", async () => {
    const res = await GET({ request: new Request("http://x/api/public/files-zip") });
    expect(res.status).toBe(400);
  });

  it("403 when token invalid", async () => {
    readZipToken.mockResolvedValue(null);
    const res = await GET({ request: req() });
    expect(res.status).toBe(403);
  });

  it("404 when no files found for tenant", async () => {
    readZipToken.mockResolvedValue({ t: "ten1", ids: [], exp: 0 });
    admin = { from: () => chain({ data: [], error: null }) };
    const res = await GET({ request: req() });
    expect(res.status).toBe(404);
  });

  it("404 when every stored object is missing", async () => {
    readZipToken.mockResolvedValue({ t: "ten1", ids: ["f1"], exp: 0 });
    admin = {
      from: (table: string) =>
        table === "team_files"
          ? chain({ data: [{ id: "f1", name: "a.txt", storage_key: "k1", team_id: "team1" }], error: null })
          : chain({ data: [], error: null }),
    };
    get.mockResolvedValue(null);
    const res = await GET({ request: req() });
    expect(res.status).toBe(404);
  });

  it("builds a zip grouped by team, deduping name collisions and using a default folder name", async () => {
    readZipToken.mockResolvedValue({ t: "ten1", ids: [], exp: 0 });
    admin = {
      from: (table: string) =>
        table === "team_files"
          ? chain({
              data: [
                { id: "f1", name: "a.txt", storage_key: "k1", team_id: "team1" },
                { id: "f2", name: "a.txt", storage_key: "k2", team_id: "team1" },
                { id: "f3", name: "b.txt", storage_key: "k3", team_id: "unknown-team" },
              ],
              error: null,
            })
          : chain({ data: [{ id: "team1", name: "Team/One*" }], error: null }),
    };
    get.mockImplementation(async (key: string) => ({ bytes: new TextEncoder().encode(key), contentType: "text/plain" }));
    const res = await GET({ request: req() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain('filename="team-files.zip"');
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(zip).sort();
    expect(names).toEqual(expect.arrayContaining(["Team_One_/2-a.txt", "Team_One_/a.txt", "team/b.txt"]));
  });
});
