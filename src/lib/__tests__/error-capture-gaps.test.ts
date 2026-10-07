import { afterEach, describe, expect, it, vi } from "vitest";

describe("error-capture gaps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the raw event when it carries no .error", async () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal("addEventListener", (name: string, fn: (e: unknown) => void) => {
      handlers[name] = fn;
    });
    vi.resetModules();
    const mod = await import("../error-capture");
    const bareEvent = { type: "error" };
    handlers.error(bareEvent);
    expect(mod.consumeLastCapturedError()).toBe(bareEvent);
  });
});
