import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn → plain async function running validator + handler in-process.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (v: (d: unknown) => unknown) => ((validate = v), b),
      handler: (h: (ctx: { data: unknown }) => unknown) => (arg?: { data?: unknown }) =>
        Promise.resolve().then(() => h({ data: validate(arg?.data) })),
    };
    return b;
  },
}));

vi.mock("@/lib/backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {}, onChangeInternal: () => {} }));
vi.mock("../backend/events.server", () => ({ publishChange: () => {}, subscribeChanges: () => () => {}, onChangeInternal: () => {} }));
let db: unknown;
vi.mock("@/lib/backend/admin.server", () => ({ getBackendAdmin: async () => db, isLocalBackend: () => true }));
vi.mock("@/lib/tenant-auth.server", () => ({
  isTenantUnlocked: async () => true,
  markTenantUnlocked: async () => {},
  hashPin: async (p: string) => `h:${p}`,
}));

type Fns = typeof import("@/lib/board.functions");
let fns: Fns;
let realDb: unknown;
let key: string;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-err-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  realDb = createLocalClient();
  db = realDb;
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  db = realDb;
  key = (await call(fns.createTenant, {})).key;
});

/**
 * A chainable thenable that ignores every query-builder method call and
 * resolves to a fixed `{ data, error }` result, so tests can force the exact
 * failure a real driver would otherwise rarely produce (network errors,
 * unique-constraint races, RPC failures, storage failures, …).
 */
function fixedResult(result: { data?: unknown; error?: unknown }) {
  const target: Record<string, unknown> = {};
  const full = { data: result.data ?? null, error: result.error ?? null };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(full);
      if (prop === "catch" || prop === "finally") return () => proxy;
      return (..._args: unknown[]) => proxy;
    },
  };
  const proxy = new Proxy(target, handler);
  return proxy;
}

/**
 * Wraps the real local admin client so that the Nth call to `.from(table)`
 * (0-indexed) returns a scripted result instead of hitting SQLite, while all
 * other calls (and storage/rpc, unless overridden) behave normally. This lets
 * tests exercise error branches that the real SQLite-backed test schema can
 * never produce on its own.
 */
function wrapAdmin(
  real: any,
  opts: {
    tables?: Record<string, Array<{ data?: unknown; error?: unknown } | "pass">>;
    storage?: Record<string, { remove?: unknown; upload?: unknown }>;
    rpc?: { data?: unknown; error?: unknown };
  },
) {
  const counters: Record<string, number> = {};
  return {
    ...real,
    from(table: string) {
      const script = opts.tables?.[table];
      const idx = (counters[table] = (counters[table] ?? 0) + 1) - 1;
      const entry = script?.[idx];
      if (!entry || entry === "pass") return real.from(table);
      return fixedResult(entry);
    },
    storage: {
      from(bucket: string) {
        const o = opts.storage?.[bucket];
        const realBucket = real.storage.from(bucket);
        return {
          ...realBucket,
          remove: o?.remove ?? realBucket.remove.bind(realBucket),
          upload: o?.upload ?? realBucket.upload.bind(realBucket),
        };
      },
    },
    rpc: opts.rpc ? async () => opts.rpc : real.rpc.bind(real),
  };
}

describe("resolveTenantRaw / getTenant error path", () => {
  it("surfaces a non-missing-column read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: [{ error: { message: "db offline" } }] } });
    await expect(call(fns.getTenant, { key })).rejects.toThrow("db offline");
  });
});

describe("createTenant", () => {
  it("throws immediately on a non-duplicate insert error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: [{ error: { message: "disk full" } }] } });
    await expect(call(fns.createTenant, {})).rejects.toThrow("disk full");
  });

  it("gives up after repeated duplicate-key collisions", async () => {
    const dup = { error: { message: "duplicate key value" } };
    db = wrapAdmin(realDb, { tables: { tenants: [dup, dup, dup, dup, dup] } });
    await expect(call(fns.createTenant, {})).rejects.toThrow("Could not generate unique tenant key");
  });
});

describe("updateTenantSettings error path", () => {
  it("surfaces a write error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass", { error: { message: "write failed" } }] } });
    await expect(
      call(fns.updateTenantSettings, {
        key,
        name: "X",
        past_grace_minutes: 10,
        template: "zeitplan",
        logo_height: 60,
        accent_color: "#aabbcc",
        slide_seconds: 10,
        focus_mode: "count",
        focus_count: 3,
        focus_minutes: 30,
        focus_dim_opacity: 35,
      }),
    ).rejects.toThrow("write failed");
  });
});

describe("forceReloadDisplays", () => {
  it("bumps and wraps the reload counter on success", async () => {
    db = wrapAdmin(realDb, {
      tables: {
        tenants: ["pass", { data: { reload_counter: 999999 } }, { error: null }],
      },
    });
    const r = await call(fns.forceReloadDisplays, { key });
    expect(r).toEqual({ ok: true, reload_counter: 0 });
  });

  it("surfaces the final update error", async () => {
    db = wrapAdmin(realDb, {
      tables: {
        tenants: ["pass", { data: { reload_counter: 1 } }, { error: { message: "update failed" } }],
      },
    });
    await expect(call(fns.forceReloadDisplays, { key })).rejects.toThrow("update failed");
  });
});

describe("updateTenantTemplate error path", () => {
  it("surfaces an update error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass", { error: { message: "nope" } }] } });
    await expect(call(fns.updateTenantTemplate, { key, template: "focus" })).rejects.toThrow("nope");
  });
});

describe("regenerateKey", () => {
  it("throws immediately on a non-duplicate error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass", { error: { message: "boom" } }] } });
    await expect(call(fns.regenerateKey, { key })).rejects.toThrow("boom");
  });

  it("gives up after repeated duplicate-key collisions", async () => {
    const dup = { error: { message: "duplicate key value" } };
    db = wrapAdmin(realDb, { tables: { tenants: ["pass", dup, dup, dup, dup, dup] } });
    await expect(call(fns.regenerateKey, { key })).rejects.toThrow("Could not generate unique key");
  });
});

describe("deleteTenant", () => {
  it("removes slide, background and logo files, and surfaces the final delete error", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "R" } });
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "T" },
    });
    await call(fns.uploadEntryBackground, {
      key,
      id: entry.id,
      filename: "pic.png",
      contentType: "image/png",
      dataBase64: Buffer.from("x").toString("base64"),
    });
    await call(fns.uploadTenantLogo, {
      key,
      filename: "logo.png",
      contentType: "image/png",
      dataBase64: Buffer.from("x").toString("base64"),
    });

    const adsRemove = vi.fn(async () => ({ data: null, error: null }));
    const bgRemove = vi.fn(async () => ({ data: null, error: null }));
    db = wrapAdmin(realDb, {
      tables: {
        slides: [{ data: [{ path: "some/slide.png" }] }, "pass"],
        tenants: ["pass", { error: { message: "delete failed" } }],
      },
      storage: { "tenant-ads": { remove: adsRemove }, "tenant-entry-backgrounds": { remove: bgRemove } },
    });

    await expect(call(fns.deleteTenant, { key })).rejects.toThrow("delete failed");
    expect(adsRemove).toHaveBeenCalledWith(["some/slide.png"]);
    expect(bgRemove).toHaveBeenCalled();
  });
});

describe("listEntries error path", () => {
  it("surfaces a non-missing-column read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.listEntries, { key })).rejects.toThrow("read failed");
  });
});

describe("upsertEntry error paths", () => {
  it("surfaces an update error when editing an existing entry", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "T" },
    });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: [{ error: { message: "update failed" } }] } });
    await expect(
      call(fns.upsertEntry, { key, entry: { id: entry.id, kind: "entry", time: new Date().toISOString(), title: "T2" } }),
    ).rejects.toThrow("update failed");
  });

  it("surfaces an insert error when creating a new entry", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: [{ error: { message: "insert failed" } }] } });
    await expect(
      call(fns.upsertEntry, { key, entry: { kind: "entry", time: new Date().toISOString(), title: "T" } }),
    ).rejects.toThrow("insert failed");
  });
});

describe("uploadEntryBackground / removeEntryBackground / deleteEntry error paths", () => {
  it("surfaces a storage upload error", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "T" },
    });
    db = wrapAdmin(realDb, {
      tables: { tenants: ["pass"] },
      storage: { "tenant-entry-backgrounds": { upload: async () => ({ error: { message: "upload failed" } }) } },
    });
    await expect(
      call(fns.uploadEntryBackground, {
        key,
        id: entry.id,
        filename: "pic.png",
        contentType: "image/png",
        dataBase64: Buffer.from("x").toString("base64"),
      }),
    ).rejects.toThrow("upload failed");
  });

  it("surfaces an update error after a successful upload", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "T" },
    });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: ["pass", { error: { message: "update failed" } }] } });
    await expect(
      call(fns.uploadEntryBackground, {
        key,
        id: entry.id,
        filename: "pic.png",
        contentType: "image/png",
        dataBase64: Buffer.from("x").toString("base64"),
      }),
    ).rejects.toThrow("update failed");
  });

  it("surfaces an update error from removeEntryBackground", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "T" },
    });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: ["pass", { error: { message: "update failed" } }] } });
    await expect(call(fns.removeEntryBackground, { key, id: entry.id })).rejects.toThrow("update failed");
  });

  it("surfaces a delete error from deleteEntry", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "T" },
    });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: ["pass", { error: { message: "delete failed" } }] } });
    await expect(call(fns.deleteEntry, { key, id: entry.id })).rejects.toThrow("delete failed");
  });
});

describe("entries JSON export/import error paths", () => {
  it("surfaces a read error from exportEntriesJson", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.exportEntriesJson, { key })).rejects.toThrow("read failed");
  });

  it("surfaces an existing-rows read error from replaceEntriesJson", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.replaceEntriesJson, { key, entries: [] })).rejects.toThrow("read failed");
  });

  it("surfaces an update error on an existing entry", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: "2024-01-01T10:00:00.000Z", title: "E1" },
    });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: ["pass", { error: { message: "update failed" } }] } });
    await expect(
      call(fns.replaceEntriesJson, { key, entries: [{ id: entry.id, time: "2024-01-01T11:00:00.000Z", title: "E1b" }] }),
    ).rejects.toThrow("update failed");
  });

  it("surfaces an insert error on a new entry", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: ["pass", { error: { message: "insert failed" } }] } });
    await expect(
      call(fns.replaceEntriesJson, { key, entries: [{ time: "2024-01-01T10:00:00.000Z", title: "New" }] }),
    ).rejects.toThrow("insert failed");
  });

  it("surfaces a delete error when removing entries", async () => {
    await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: "2024-01-01T10:00:00.000Z", title: "Remove me" },
    });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], entries: ["pass", { error: { message: "delete failed" } }] } });
    await expect(call(fns.replaceEntriesJson, { key, entries: [] })).rejects.toThrow("delete failed");
  });
});

describe("rooms error paths", () => {
  it("surfaces a listRooms read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], rooms: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.listRooms, { key })).rejects.toThrow("read failed");
  });

  it("surfaces an upsertRoom update error", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "R" } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], rooms: [{ error: { message: "update failed" } }] } });
    await expect(call(fns.upsertRoom, { key, room: { id: room.id, name: "R2" } })).rejects.toThrow("update failed");
  });

  it("surfaces an upsertRoom insert error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], rooms: [{ error: { message: "insert failed" } }] } });
    await expect(call(fns.upsertRoom, { key, room: { name: "R" } })).rejects.toThrow("insert failed");
  });

  it("surfaces a deleteRoom error", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "R" } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], rooms: [{ error: { message: "delete failed" } }] } });
    await expect(call(fns.deleteRoom, { key, id: room.id })).rejects.toThrow("delete failed");
  });
});

describe("teams error paths", () => {
  it("surfaces a listTeams read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.listTeams, { key })).rejects.toThrow("read failed");
  });

  it("surfaces an upsertTeam update error", async () => {
    const team = await call(fns.upsertTeam, { key, team: { name: "A" } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: [{ error: { message: "update failed" } }] } });
    await expect(call(fns.upsertTeam, { key, team: { id: team.id, name: "B" } })).rejects.toThrow("update failed");
  });

  it("surfaces an upsertTeam insert error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: ["pass", { error: { message: "insert failed" } }] } });
    await expect(call(fns.upsertTeam, { key, team: { name: "A" } })).rejects.toThrow("insert failed");
  });

  it("surfaces a deleteTeam error", async () => {
    const team = await call(fns.upsertTeam, { key, team: { name: "A" } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: [{ error: { message: "delete failed" } }] } });
    await expect(call(fns.deleteTeam, { key, id: team.id })).rejects.toThrow("delete failed");
  });

  it("surfaces a reorderTeams error", async () => {
    const team = await call(fns.upsertTeam, { key, team: { name: "A" } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: [{ error: { message: "reorder failed" } }] } });
    await expect(call(fns.reorderTeams, { key, ids: [team.id] })).rejects.toThrow("reorder failed");
  });

  it("surfaces an exportTeamsJson read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.exportTeamsJson, { key })).rejects.toThrow("read failed");
  });

  it("surfaces a replaceTeamsJson existing-rows read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.replaceTeamsJson, { key, teams: [] })).rejects.toThrow("read failed");
  });

  it("surfaces replaceTeamsJson update/insert/delete errors", async () => {
    const team = await call(fns.upsertTeam, { key, team: { name: "A" } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: ["pass", { error: { message: "update failed" } }] } });
    await expect(
      call(fns.replaceTeamsJson, { key, teams: [{ id: team.id, name: "B" }] }),
    ).rejects.toThrow("update failed");

    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: ["pass", { error: { message: "insert failed" } }] } });
    await expect(call(fns.replaceTeamsJson, { key, teams: [{ name: "C" }] })).rejects.toThrow("insert failed");

    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], teams: ["pass", { error: { message: "delete failed" } }] } });
    await expect(call(fns.replaceTeamsJson, { key, teams: [] })).rejects.toThrow("delete failed");
  });
});

describe("webhooks error paths", () => {
  it("surfaces a listWebhooks read error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], webhooks: [{ error: { message: "read failed" } }] } });
    await expect(call(fns.listWebhooks, { key })).rejects.toThrow("read failed");
  });

  it("surfaces an upsertWebhook update error", async () => {
    const wh = await call(fns.upsertWebhook, { key, webhook: { name: "W", type: "discord", enabled: true } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], webhooks: [{ error: { message: "update failed" } }] } });
    await expect(
      call(fns.upsertWebhook, { key, webhook: { id: wh.id, name: "W2", type: "discord", enabled: true } }),
    ).rejects.toThrow("update failed");
  });

  it("surfaces an upsertWebhook insert error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], webhooks: [{ error: { message: "insert failed" } }] } });
    await expect(
      call(fns.upsertWebhook, { key, webhook: { name: "W", type: "discord", enabled: true } }),
    ).rejects.toThrow("insert failed");
  });

  it("surfaces a deleteWebhook error", async () => {
    const wh = await call(fns.upsertWebhook, { key, webhook: { name: "W", type: "discord", enabled: true } });
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], webhooks: [{ error: { message: "delete failed" } }] } });
    await expect(call(fns.deleteWebhook, { key, id: wh.id })).rejects.toThrow("delete failed");
  });

  it("surfaces a testWebhook lookup error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], webhooks: [{ error: { message: "lookup failed" } }] } });
    await expect(call(fns.testWebhook, { key, id: "11111111-1111-1111-1111-111111111111" })).rejects.toThrow(
      "lookup failed",
    );
  });

  it("surfaces a sendWebhookMessage lookup error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"], webhooks: [{ error: { message: "lookup failed" } }] } });
    await expect(
      call(fns.sendWebhookMessage, { key, message: { title: "Hi", description: "" } }),
    ).rejects.toThrow("lookup failed");
  });

  it("surfaces a getNextWebhookDispatch rpc error", async () => {
    db = wrapAdmin(realDb, { tables: { tenants: ["pass"] }, rpc: { error: { message: "rpc failed" } } });
    await expect(call(fns.getNextWebhookDispatch, { key })).rejects.toThrow("rpc failed");
  });
});

describe("getRoomSnapshot error path", () => {
  it("surfaces a room lookup error", async () => {
    db = wrapAdmin(realDb, { tables: { rooms: [{ error: { message: "room lookup failed" } }] } });
    await expect(
      call(fns.getRoomSnapshot, { key, roomId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow("room lookup failed");
  });

  it("surfaces an entries lookup error", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Main" } });
    db = wrapAdmin(realDb, { tables: { rooms: ["pass"], entries: [{ error: { message: "entries failed" } }] } });
    await expect(call(fns.getRoomSnapshot, { key, roomId: room.id })).rejects.toThrow("entries failed");
  });
});
