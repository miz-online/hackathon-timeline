import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeHex } from "../colors";
import { expandPracticeEntries } from "../practice";
import { buildDiscordPayload, sendWebhook } from "../webhooks";

describe("colors gaps", () => {
  it("leaves an already-# prefixed value alone before validating", () => {
    expect(normalizeHex("#abcdef")).toBe("#ABCDEF");
  });
});

describe("practice gaps", () => {
  const base = {
    id: "p",
    kind: "practice",
    time: "2026-01-01T10:00:00.000Z",
    end_time: null,
    title: "Übungszeit",
    description: "",
    tags: [],
    color: "#111111",
  };
  const teams = [{ id: "a", name: "A", room_id: "r1", color: "#AA0000" }];

  it("falls back to 10 minutes when practiceMinutes is falsy", () => {
    const out = expandPracticeEntries([base], {
      teams,
      practiceMinutes: 0,
      scope: "all",
      roomId: "r1",
      isOverview: false,
    });
    expect(out[0].time).toBe("2026-01-01T10:00:00.000Z");
  });

  it("treats an entry with no kind as 'entry', leaving it unchanged", () => {
    const e = { ...base };
    delete (e as { kind?: string }).kind;
    const out = expandPracticeEntries([e], {
      teams,
      practiceMinutes: 10,
      scope: "all",
      roomId: "r1",
      isOverview: false,
    });
    expect(out).toEqual([e]);
  });
});

describe("webhooks gaps", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults the attachment content type when the image has none", () => {
    const p = buildDiscordPayload({
      title: "T",
      description: "",
      image: { filename: "pic", bytes: new Uint8Array(), contentType: "" },
    } as never);
    expect(p.embeds[0].image?.url).toBe("attachment://pic.png");
  });

  it("reports a plain status when the error body can't be read as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Error",
        text: () => Promise.reject(new Error("no body")),
      })),
    );
    const res = await sendWebhook("https://discord.test/hook", "discord", {
      title: "T",
      description: "",
    });
    expect(res).toEqual({ ok: false, error: "500 Internal Error" });
  });
});
