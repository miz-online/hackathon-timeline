import { describe, it, expect, vi, afterEach } from "vitest";
import {
  randomToken,
  roomTokenVariant,
  roomForToken,
  registrationUrl,
  teamEditUrl,
  REGISTER_TOKEN_LENGTH,
} from "../registration";
import { withRoomRegisterTokens } from "../register-url";
import { buildDiscordPayload, sendWebhook } from "../webhooks";
import { derivePalette, hexToRgb, lighten, darken, rgba, luminance } from "../colors";
import { cn } from "../utils";

const ALPHA = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

describe("registration tokens", () => {
  it("generates tokens without confusable characters", () => {
    const t = randomToken();
    expect(t).toHaveLength(REGISTER_TOKEN_LENGTH);
    expect(t).toMatch(ALPHA);
    expect(randomToken(12)).toHaveLength(12);
  });

  it("room variants are stable, distinct and resolvable", async () => {
    const a = await roomTokenVariant("BASETOKEN1", "room-a");
    expect(a).toBe(await roomTokenVariant("BASETOKEN1", "room-a"));
    expect(a).not.toBe(await roomTokenVariant("BASETOKEN1", "room-b"));
    expect(a).not.toBe(await roomTokenVariant("OTHERTOKEN", "room-a"));
    expect(a).toMatch(ALPHA);
    expect(await roomForToken("BASETOKEN1", a, ["room-b", "room-a"])).toBe("room-a");
    expect(await roomForToken("BASETOKEN1", "BASETOKEN1", ["room-a"])).toBeNull();
    expect(await roomForToken("BASETOKEN1", "FORGEDXXXX", ["room-a"])).toBeNull();
  });

  it("builds URLs without double slashes", () => {
    expect(registrationUrl("https://x.app/", "ABC")).toBe("https://x.app/tr/ABC");
    expect(teamEditUrl("https://x.app", "ABC", "CODE")).toBe("https://x.app/tr/ABC/CODE");
  });

  it("replaces register tokens per room, keeps overview and other entries", async () => {
    const entries = [
      { kind: "register", register_token: "BASETOKEN1" },
      { kind: "entry", register_token: null },
      { kind: "register", register_token: null },
    ];
    const room = await withRoomRegisterTokens(entries, "room-a", false);
    expect(room[0].register_token).toBe(await roomTokenVariant("BASETOKEN1", "room-a"));
    expect(room[1]).toBe(entries[1]);
    expect(room[2]).toBe(entries[2]);
    const overview = await withRoomRegisterTokens(entries, "room-a", true);
    expect(overview[0].register_token).toBe("BASETOKEN1");
  });
});

describe("Discord payload branches", () => {
  it("handles missing time, single time, color and default file names", () => {
    expect(buildDiscordPayload({ title: "A", description: "d" }).embeds[0]).toEqual({
      title: "A",
      description: "d",
    });
    const p = buildDiscordPayload({
      title: "B",
      description: "",
      time: new Date("2026-01-01T10:00:00Z"),
      color: "#ff0000",
      image: { filename: "", bytes: new Uint8Array(), contentType: "" },
    });
    expect(p.embeds[0].title).toBe("<t:1767261600:t>: B");
    expect(p.embeds[0].color).toBe(0xff0000);
    expect(p.embeds[0].image?.url).toBe("attachment://image.png");
  });
});

describe("sendWebhook", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects unsupported types without calling the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await sendWebhook("u", "slack" as never, { title: "x", description: "" });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("posts JSON without image and multipart with image", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    expect(await sendWebhook("u", "discord", { title: "x", description: "" })).toEqual({ ok: true });
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
    await sendWebhook("u", "discord", {
      title: "x",
      description: "",
      image: { filename: "a.jpg", bytes: new Uint8Array([1]), contentType: "image/jpeg" },
    });
    expect(f.mock.calls[1][1].body).toBeInstanceOf(FormData);
  });

  it("reports HTTP and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400, statusText: "Bad Request" })));
    expect(await sendWebhook("u", "discord", { title: "x", description: "" })).toEqual({
      ok: false,
      error: "400 Bad Request — bad",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await sendWebhook("u", "discord", { title: "x", description: "" })).toEqual({
      ok: false,
      error: "offline",
    });
  });
});

describe("colors and utils", () => {
  it("mixes, converts and picks readable text", () => {
    expect(hexToRgb("#102030")).toEqual({ r: 16, g: 32, b: 48 });
    expect(lighten("#000000", 1)).toBe("#FFFFFF");
    expect(darken("#FFFFFF", 1)).toBe("#000000");
    expect(rgba("#FF0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
    expect(derivePalette("#FFFF00").onBase).toBe("#1F2937");
    expect(derivePalette("#000080").onBase).toBe("#FFFFFF");
  });
  it("merges class names", () => {
    expect(cn("p-2", false && "x", "p-4")).toBe("p-4");
  });
});
