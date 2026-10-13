import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHex } from "@/lib/colors";
import { sendWebhook } from "@/lib/webhooks";

afterEach(() => vi.unstubAllGlobals());

describe("normalizeHex", () => {
  it("handles empty/undefined input without throwing", () => {
    expect(() => normalizeHex(undefined as unknown as string)).not.toThrow();
    expect(() => normalizeHex("")).not.toThrow();
  });
});

describe("sendWebhook image without content type", () => {
  it("falls back to image/png", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const file = (init.body as FormData).get("files[0]") as Blob;
      expect(file.type).toBe("image/png");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendWebhook("https://discord.test/x", "discord", {
      title: "T",
      image: { filename: "a.png", bytes: new Uint8Array([1]), contentType: "" },
    } as never);
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
