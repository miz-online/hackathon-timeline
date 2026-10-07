import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeHex } from "../colors";
import { localIsoNow } from "../entries-json";
import { expandPracticeEntries } from "../practice";
import { slugify, uniqueRefId } from "../ref-id";
import { getStoredTenantKey, setStoredTenantKey, clearStoredTenantKey } from "../tenant-storage";
import { buildDiscordPayload } from "../webhooks";
import { onTenantLocked } from "../tenant-lock";

describe("colors: already-prefixed hex", () => {
  it("keeps a leading # as-is", () => {
    expect(normalizeHex("#abcdef")).toBe("#ABCDEF");
  });
});

describe("local time stamp sign branch", () => {
  afterEach(() => vi.useRealTimers());
  it("covers both positive and negative timezone offsets", () => {
    const d = new Date("2026-06-01T12:00:00Z");
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-60);
    expect(localIsoNow(d)).toMatch(/\+01:00$/);
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(60);
    expect(localIsoNow(d)).toMatch(/-01:00$/);
    vi.restoreAllMocks();
  });
});

describe("practice: overview + assigned scope", () => {
  const base = { id: "p", kind: "practice", time: "2026-01-01T10:00:00.000Z", end_time: null, title: "x", description: "", tags: [], color: null };
  const teams = [{ id: "a", name: "A", room_id: "r1", color: null }];
  it("overview short-circuits the assigned-room filter", () => {
    const out = expandPracticeEntries([base], { teams, practiceMinutes: 10, scope: "assigned", roomId: "r2", isOverview: true });
    expect(out).toHaveLength(1);
  });
  it("team without a room is never hidden", () => {
    const freeTeams = [{ id: "a", name: "A", room_id: null, color: null }];
    const out = expandPracticeEntries([base], { teams: freeTeams, practiceMinutes: 10, scope: "assigned", roomId: "r2", isOverview: false });
    expect(out).toHaveLength(1);
  });
});

describe("ref-id edge cases", () => {
  it("slugify tolerates missing input", () => {
    expect(slugify(undefined as unknown as string)).toBe("");
    expect(slugify(null as unknown as string)).toBe("");
  });
  it("walks past multiple collisions", () => {
    const taken = new Set<string>(["raum", "raum-2"]);
    expect(uniqueRefId("raum", taken)).toBe("raum-3");
  });
});

describe("tenant-storage: clear on the server", () => {
  it("is a no-op without window", () => {
    expect(() => clearStoredTenantKey()).not.toThrow();
    expect(getStoredTenantKey()).toBeNull();
    expect(() => setStoredTenantKey("x")).not.toThrow();
  });
});

describe("webhooks: remaining branches", () => {
  it("skips the color field when deriving a falsy palette color", () => {
    const p = buildDiscordPayload({ title: "A", description: "", color: "" });
    expect(p.embeds[0].color).toBeUndefined();
  });
  it("names an image without an extension", () => {
    const p = buildDiscordPayload({
      title: "A",
      description: "",
      image: { filename: "picture", bytes: new Uint8Array(), contentType: "image/png" },
    });
    expect(p.embeds[0].image?.url).toBe("attachment://picture.png");
  });
});

describe("tenant-lock: server no-op unsubscribe", () => {
  it("the returned unsubscribe function is callable", () => {
    const off = onTenantLocked(() => {});
    expect(() => off()).not.toThrow();
  });
});

describe("error-capture: addEventListener branch", () => {
  it("does not throw when addEventListener is unavailable", async () => {
    const orig = globalThis.addEventListener;
    // @ts-expect-error - simulate an environment without addEventListener
    delete globalThis.addEventListener;
    const { vi: v } = await import("vitest");
    v.resetModules();
    await import("../error-capture");
    globalThis.addEventListener = orig;
  });
});
