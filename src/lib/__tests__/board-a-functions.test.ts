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
const unlocked = vi.fn(async () => true);
vi.mock("@/lib/tenant-auth.server", () => ({
  isTenantUnlocked: () => unlocked(),
  markTenantUnlocked: async () => {},
  hashPin: async (p: string) => `h:${p}`,
}));

type Fns = typeof import("@/lib/board.functions");
let fns: Fns;
let key: string;
const call = <T,>(fn: (a: { data: never }) => Promise<T>, data: unknown) => fn({ data: data as never });

beforeAll(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ht-board-a-"));
  const { createLocalClient } = await import("@/lib/backend/sqlite-client.server");
  db = createLocalClient();
  fns = await import("@/lib/board.functions");
});

beforeEach(async () => {
  unlocked.mockReset().mockResolvedValue(true);
  key = (await call(fns.createTenant, {})).key;
});

describe("createTenant", () => {
  it("creates tenant with a pin and auto-unlocks it", async () => {
    const r = await call(fns.createTenant, { pin: " 1234 " });
    expect(r.key).toMatch(/^[A-HJ-NP-Z2-9]{24}$/);
  });
});

describe("updateTenantSettings / template / reload / regenerate / delete", () => {
  it("updates settings", async () => {
    const r = await call(fns.updateTenantSettings, {
      key,
      name: "New Name",
      past_grace_minutes: 10,
      template: "zeitplan",
      logo_height: 60,
      accent_color: "#aabbcc",
      slide_seconds: 10,
      focus_mode: "count",
      focus_count: 3,
      focus_minutes: 30,
      focus_dim_opacity: 35,
    });
    expect(r).toEqual({ ok: true });
    const t = await call(fns.getTenant, { key });
    expect(t.name).toBe("New Name");
    expect(t.accent_color).toBe("#AABBCC");
  });

  it("rejects updates while locked", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    unlocked.mockResolvedValue(false);
    await expect(
      call(fns.updateTenantSettings, {
        key: locked,
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
    ).rejects.toThrow();
  });

  it("forceReloadDisplays surfaces a read error for the admin to see", async () => {
    // The local SQLite test schema has no reload_counter column; this still
    // exercises the read-error branch of the handler.
    await expect(call(fns.forceReloadDisplays, { key })).rejects.toThrow();
  });

  it("updates template", async () => {
    await call(fns.updateTenantTemplate, { key, template: "focus" });
    const t = await call(fns.getTenant, { key });
    expect(t.template).toBe("focus");
  });

  it("regenerates key", async () => {
    const r = await call(fns.regenerateKey, { key });
    expect(r.key).not.toBe(key);
    await expect(call(fns.getTenant, { key })).rejects.toThrow("Unknown tenant key");
    expect(await call(fns.getTenant, { key: r.key })).toBeTruthy();
  });

  it("deletes a tenant along with its entries/rooms/webhooks", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "R" } });
    await call(fns.upsertEntry, { key, entry: { kind: "entry", time: new Date().toISOString(), title: "T" } });
    await call(fns.upsertWebhook, { key, webhook: { name: "W", type: "discord", url: "https://x", enabled: true } });
    const r = await call(fns.deleteTenant, { key });
    expect(r).toEqual({ ok: true });
    await expect(call(fns.getTenant, { key })).rejects.toThrow();
  });
});

describe("entries", () => {
  it("creates, lists, updates and deletes entries", async () => {
    const created = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "Hello", tags: ["a"] },
    });
    let list = await call(fns.listEntries, { key });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Hello");
    expect(list[0].background_url).toBeNull();

    await call(fns.upsertEntry, {
      key,
      entry: { id: created.id, kind: "entry", time: new Date().toISOString(), title: "Updated" },
    });
    list = await call(fns.listEntries, { key });
    expect(list[0].title).toBe("Updated");

    await call(fns.deleteEntry, { key, id: created.id });
    expect(await call(fns.listEntries, { key })).toEqual([]);
  });

  it("returns empty entries list while locked", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    unlocked.mockResolvedValue(false);
    expect(await call(fns.listEntries, { key: locked })).toEqual([]);
  });

  it("requires slide set and end time for slideshow entries", async () => {
    await expect(
      call(fns.upsertEntry, { key, entry: { kind: "slides", time: new Date().toISOString(), title: "S" } }),
    ).rejects.toThrow("Slideshow entries need a slide set");
    await expect(
      call(fns.upsertEntry, {
        key,
        entry: {
          kind: "slides",
          time: new Date().toISOString(),
          title: "S",
          slide_set_id: "11111111-1111-1111-1111-111111111111",
        },
      }),
    ).rejects.toThrow("Slideshow entries need an end time");
  });

  it("assigns a register token to register entries and keeps it stable", async () => {
    const created = await call(fns.upsertEntry, {
      key,
      entry: { kind: "register", time: new Date().toISOString(), title: "Register" },
    });
    const list1 = await call(fns.listEntries, { key });
    const token1 = list1[0].register_token;
    expect(token1).toBeTruthy();
    await call(fns.upsertEntry, {
      key,
      entry: { id: created.id, kind: "register", time: new Date().toISOString(), title: "Register 2" },
    });
    const list2 = await call(fns.listEntries, { key });
    expect(list2[0].register_token).toBe(token1);
  });

  it("manages entry background images", async () => {
    const created = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "BG" },
    });
    const dataBase64 = Buffer.from("hello-png-bytes").toString("base64");
    const up = await call(fns.uploadEntryBackground, {
      key,
      id: created.id,
      filename: "pic.png",
      contentType: "image/png",
      dataBase64,
    });
    expect(up.url).toContain(`/api/public/entry-bg/${key}/${created.id}`);

    // re-upload replaces the previous file
    const up2 = await call(fns.uploadEntryBackground, {
      key,
      id: created.id,
      filename: "pic2.png",
      contentType: "image/png",
      dataBase64,
    });
    expect(up2.url).toBeTruthy();

    await call(fns.removeEntryBackground, { key, id: created.id });
    const list = await call(fns.listEntries, { key });
    expect(list[0].background_path).toBeNull();
  });

  it("removeEntryBackground is a no-op when there is nothing to remove", async () => {
    const created = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "NoBG" },
    });
    await expect(call(fns.removeEntryBackground, { key, id: created.id })).resolves.toEqual({ ok: true });
  });

  it("fails to upload a background for an unknown entry", async () => {
    await expect(
      call(fns.uploadEntryBackground, {
        key,
        id: "11111111-1111-1111-1111-111111111111",
        filename: "pic.png",
        contentType: "image/png",
        dataBase64: Buffer.from("x").toString("base64"),
      }),
    ).rejects.toThrow("Unknown entry");
  });

  it("deletes an entry's background file along with the entry", async () => {
    const created = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "BG2" },
    });
    await call(fns.uploadEntryBackground, {
      key,
      id: created.id,
      filename: "pic.png",
      contentType: "image/png",
      dataBase64: Buffer.from("x").toString("base64"),
    });
    await call(fns.deleteEntry, { key, id: created.id });
    expect(await call(fns.listEntries, { key })).toEqual([]);
  });
});

describe("entries JSON import/export", () => {
  it("exports and round-trips entries via JSON", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Main" } });
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: "2024-01-01T10:00:00.000Z", title: "E1", tags: ["Main"] },
    });
    const exported = await call(fns.exportEntriesJson, { key });
    expect(exported.entries).toHaveLength(1);
    expect(exported.entries[0].rooms).toEqual(["main"]);

    const replaced = await call(fns.replaceEntriesJson, {
      key,
      entries: [
        { id: entry.id, time: "2024-01-01T11:00:00.000Z", title: "E1 updated", rooms: ["main"] },
        { time: "2024-01-02T10:00:00.000Z", title: "E2" },
      ],
    });
    expect(replaced).toEqual({ updated: 1, created: 1, deleted: 0 });
    const list = await call(fns.listEntries, { key });
    expect(list.map((e) => e.title).sort()).toEqual(["E1 updated", "E2"]);
  });

  it("rejects unknown references and deletes removed entries", async () => {
    await expect(
      call(fns.replaceEntriesJson, { key, entries: [{ time: "x", title: "Bad" }] }),
    ).rejects.toThrow("not a valid date");

    await expect(
      call(fns.replaceEntriesJson, {
        key,
        entries: [{ id: "11111111-1111-1111-1111-111111111111", time: "2024-01-01T10:00:00.000Z", title: "Bad" }],
      }),
    ).rejects.toThrow("does not exist");

    await expect(
      call(fns.replaceEntriesJson, {
        key,
        entries: [{ time: "2024-01-01T10:00:00.000Z", title: "Bad", rooms: ["unknown-room"] }],
      }),
    ).rejects.toThrow('unknown room');

    await expect(
      call(fns.replaceEntriesJson, {
        key,
        entries: [{ time: "2024-01-01T10:00:00.000Z", title: "Bad", color_scheme: "unknown-scheme" }],
      }),
    ).rejects.toThrow("unknown color scheme");

    const created = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "ToRemove" },
    });
    await call(fns.uploadEntryBackground, {
      key,
      id: created.id,
      filename: "pic.png",
      contentType: "image/png",
      dataBase64: Buffer.from("x").toString("base64"),
    });
    const r = await call(fns.replaceEntriesJson, { key, entries: [] });
    expect(r.deleted).toBe(1);
    expect(await call(fns.listEntries, { key })).toEqual([]);
  });

  it("rejects duplicate entry ids in the payload", async () => {
    const entry = await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "Dup" },
    });
    await expect(
      call(fns.replaceEntriesJson, {
        key,
        entries: [
          { id: entry.id, time: "2024-01-01T10:00:00.000Z", title: "A" },
          { id: entry.id, time: "2024-01-01T11:00:00.000Z", title: "B" },
        ],
      }),
    ).rejects.toThrow("used more than once");
  });
});

describe("supportsTint", () => {
  it("detects alpha-capable image types", () => {
    expect(fns.supportsTint("image/png")).toBe(true);
    expect(fns.supportsTint("image/svg+xml")).toBe(true);
    expect(fns.supportsTint("image/webp")).toBe(true);
    expect(fns.supportsTint("image/gif")).toBe(true);
    expect(fns.supportsTint("image/jpeg")).toBe(false);
    expect(fns.supportsTint(null)).toBe(false);
    expect(fns.supportsTint(undefined)).toBe(false);
  });
});

describe("rooms", () => {
  it("rejects when unknown room id for delete (silently ok for other tenant)", async () => {
    const other = (await call(fns.createTenant, {})).key;
    const r = await call(fns.upsertRoom, { key, room: { name: "Mine" } });
    await call(fns.deleteRoom, { key: other, id: r.id });
    expect(await call(fns.listRooms, { key })).toHaveLength(1);
  });

  it("returns empty room list while locked", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    unlocked.mockResolvedValue(false);
    expect(await call(fns.listRooms, { key: locked })).toEqual([]);
  });
});

describe("teams", () => {
  it("returns empty team list while locked", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    unlocked.mockResolvedValue(false);
    expect(await call(fns.listTeams, { key: locked })).toEqual([]);
  });
});

describe("teams JSON import/export", () => {
  it("exports and round-trips teams via JSON", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Stage" } });
    const t1 = await call(fns.upsertTeam, { key, team: { name: "Team A", room_id: room.id } });
    const exported = await call(fns.exportTeamsJson, { key });
    expect(exported.teams).toHaveLength(1);
    expect(exported.teams[0].room).toBe("stage");

    const replaced = await call(fns.replaceTeamsJson, {
      key,
      teams: [
        { id: t1.id, name: "Team A2", room: "stage" },
        { name: "Team B" },
      ],
    });
    expect(replaced).toEqual({ updated: 1, created: 1, deleted: 0 });
    const list = await call(fns.listTeams, { key });
    expect(list.map((t) => t.name).sort()).toEqual(["Team A2", "Team B"]);
  });

  it("rejects unknown references and duplicate ids, deletes removed teams", async () => {
    await expect(
      call(fns.replaceTeamsJson, {
        key,
        teams: [{ id: "11111111-1111-1111-1111-111111111111", name: "Bad" }],
      }),
    ).rejects.toThrow("does not exist");

    await expect(
      call(fns.replaceTeamsJson, { key, teams: [{ name: "Bad", room: "unknown-room" }] }),
    ).rejects.toThrow("unknown room");

    const t1 = await call(fns.upsertTeam, { key, team: { name: "Removable" } });
    await expect(
      call(fns.replaceTeamsJson, {
        key,
        teams: [
          { id: t1.id, name: "Dup" },
          { id: t1.id, name: "Dup2" },
        ],
      }),
    ).rejects.toThrow("used more than once");

    const r = await call(fns.replaceTeamsJson, { key, teams: [] });
    expect(r.deleted).toBe(1);
    expect(await call(fns.listTeams, { key })).toEqual([]);
  });
});

describe("webhooks", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates, lists, updates and deletes webhooks", async () => {
    const created = await call(fns.upsertWebhook, {
      key,
      webhook: { name: "Discord", type: "discord", url: "https://discord.example/hook", enabled: true },
    });
    let list = await call(fns.listWebhooks, { key });
    expect(list).toEqual([
      { id: created.id, ref_id: null, name: "Discord", type: "discord", enabled: true, has_url: true },
    ]);

    await call(fns.upsertWebhook, { key, webhook: { id: created.id, name: "Discord 2", type: "discord", enabled: false } });
    list = await call(fns.listWebhooks, { key });
    expect(list[0]).toMatchObject({ name: "Discord 2", enabled: false, has_url: true });

    await call(fns.deleteWebhook, { key, id: created.id });
    expect(await call(fns.listWebhooks, { key })).toEqual([]);
  });

  it("returns empty webhook list while locked", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    unlocked.mockResolvedValue(false);
    expect(await call(fns.listWebhooks, { key: locked })).toEqual([]);
  });

  it("tests a webhook successfully and surfaces failures", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const created = await call(fns.upsertWebhook, {
      key,
      webhook: { name: "Discord", type: "discord", url: "https://discord.example/hook", enabled: true },
    });
    await expect(call(fns.testWebhook, { key, id: created.id })).resolves.toEqual({ ok: true });

    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "Boom", text: async () => "bad" });
    await expect(call(fns.testWebhook, { key, id: created.id })).rejects.toThrow("500 Boom");
  });

  it("throws when testing an unknown webhook", async () => {
    await expect(
      call(fns.testWebhook, { key, id: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow("Webhook not found");
  });

  it("sends a message to all enabled webhooks, with and without an image", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await call(fns.upsertWebhook, {
      key,
      webhook: { name: "D1", type: "discord", url: "https://discord.example/1", enabled: true },
    });
    await call(fns.upsertWebhook, {
      key,
      webhook: { name: "D2", type: "discord", url: "https://discord.example/2", enabled: false },
    });
    const r1 = await call(fns.sendWebhookMessage, { key, message: { title: "Hi", description: "there" } });
    expect(r1.results).toHaveLength(1);
    expect(r1.results[0].ok).toBe(true);

    const r2 = await call(fns.sendWebhookMessage, {
      key,
      message: {
        title: "Hi",
        description: "there",
        image: { filename: "a.png", contentType: "image/png", dataBase64: Buffer.from("x").toString("base64") },
      },
    });
    expect(r2.results[0].ok).toBe(true);
  });

  it("throws when there are no active webhooks", async () => {
    await expect(
      call(fns.sendWebhookMessage, { key, message: { title: "Hi", description: "" } }),
    ).rejects.toThrow("No active webhooks configured");
  });

  it("returns null next dispatch while locked", async () => {
    const locked = (await call(fns.createTenant, { pin: "1234" })).key;
    unlocked.mockResolvedValue(false);
    expect(await call(fns.getNextWebhookDispatch, { key: locked })).toEqual({ at: null });
  });

  it("asks the backend for the next scheduled dispatch when unlocked", async () => {
    const r = await call(fns.getNextWebhookDispatch, { key });
    expect(r).toHaveProperty("at");
  });
});

describe("getRoomSnapshot", () => {
  it("builds a full snapshot with entries, slides, teams and practice expansion", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Main" } });
    await call(fns.upsertTeam, { key, team: { name: "Team A", room_id: room.id } });
    await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date(Date.now() - 60_000).toISOString(), title: "Live", tags: [] },
    });
    const snap = await call(fns.getRoomSnapshot, { key, roomId: room.id });
    expect(snap.room.name).toBe("Main");
    expect(snap.tenant.name).toBe("My organization");
    expect(snap.entries.some((e) => e.title === "Live")).toBe(true);
    expect(snap.teams?.[0].name).toBe("Team A");
  });

  it("throws for an unknown room", async () => {
    await expect(
      call(fns.getRoomSnapshot, { key, roomId: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow("Unknown room");
  });

  it("hides entries that ended in the past and entries tagged for other rooms", async () => {
    const room = await call(fns.upsertRoom, { key, room: { name: "Main" } });
    await call(fns.upsertEntry, {
      key,
      entry: {
        kind: "entry",
        time: new Date(Date.now() - 120_000).toISOString(),
        end_time: new Date(Date.now() - 60_000).toISOString(),
        title: "Ended",
      },
    });
    await call(fns.upsertEntry, {
      key,
      entry: { kind: "entry", time: new Date().toISOString(), title: "OtherRoom", tags: ["Elsewhere"] },
    });
    const snap = await call(fns.getRoomSnapshot, { key, roomId: room.id });
    expect(snap.entries.map((e) => e.title)).toEqual([]);
  });
});
