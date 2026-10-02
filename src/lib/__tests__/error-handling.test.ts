import { describe, it, expect, vi, afterEach } from "vitest";
import { renderErrorPage } from "../error-page";
import { reportLovableError } from "../lovable-error-reporting";

describe("error page", () => {
  it("offers retry and home without leaking details", () => {
    const html = renderErrorPage();
    expect(html).toContain("location.reload()");
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/stack|Error:/);
  });
});

describe("error reporting", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("does nothing on the server or without a reporter", () => {
    expect(() => reportLovableError(new Error("x"))).not.toThrow();
    vi.stubGlobal("window", { location: { pathname: "/a" } });
    expect(() => reportLovableError(new Error("x"))).not.toThrow();
  });
  it("forwards the error with route and context", () => {
    const capture = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/tenant/acme" },
      __lovableEvents: { captureException: capture },
    });
    const err = new Error("boom");
    reportLovableError(err, { extra: 1 });
    expect(capture).toHaveBeenCalledWith(
      err,
      { source: "react_error_boundary", route: "/tenant/acme", extra: 1 },
      { mechanism: "react_error_boundary", handled: false, severity: "error" },
    );
  });
});

describe("error capture", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function load() {
    const handlers: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal("addEventListener", (name: string, fn: (e: unknown) => void) => {
      handlers[name] = fn;
    });
    vi.resetModules();
    const mod = await import("../error-capture");
    return { ...mod, handlers };
  }

  it("returns the last error once", async () => {
    const { consumeLastCapturedError, handlers } = await load();
    expect(consumeLastCapturedError()).toBeUndefined();
    const err = new Error("e");
    handlers.error({ error: err });
    expect(consumeLastCapturedError()).toBe(err);
    expect(consumeLastCapturedError()).toBeUndefined();
    handlers.unhandledrejection({ reason: "why" });
    expect(consumeLastCapturedError()).toBe("why");
  });

  it("forgets errors older than 5 seconds", async () => {
    vi.useFakeTimers();
    const { consumeLastCapturedError, handlers } = await load();
    handlers.error({ error: new Error("old") });
    vi.advanceTimersByTime(6000);
    expect(consumeLastCapturedError()).toBeUndefined();
  });
});
