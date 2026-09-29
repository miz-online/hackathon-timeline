import { describe, it, expect } from "vitest";
import { normalizeFileMode, formatBytes } from "../files";
import { buildDiscordPayload } from "../webhooks";

describe("files", () => {
  it("falls back to full mode", () => {
    expect(normalizeFileMode("download")).toBe("download");
    expect(normalizeFileMode("weird")).toBe("full");
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("Discord payload", () => {
  it("puts time range in the title and never includes a URL", () => {
    const p = buildDiscordPayload({
      title: "Pitch",
      description: "",
      time: new Date("2026-01-01T10:00:00Z"),
      endTime: new Date("2026-01-01T11:00:00Z"),
      image: { filename: "my pic", bytes: new Uint8Array(), contentType: "image/png" },
    } as never);
    expect(p.embeds[0].title).toBe("<t:1767261600:t> - <t:1767265200:t>: Pitch");
    expect(p.embeds[0].description).toBeUndefined();
    expect(p.embeds[0].image?.url).toBe("attachment://my_pic.png");
    expect(JSON.stringify(p)).not.toMatch(/https?:/);
  });
});
