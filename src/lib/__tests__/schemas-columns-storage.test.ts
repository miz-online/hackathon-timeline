import { describe, it, expect, vi, afterEach } from "vitest";
import { entriesJsonSchemaDoc, entrySnippetBody } from "../entries-json";
import { teamsJsonSchemaDoc, teamSnippetBody } from "../teams-json";
import { isMissingColumnError, withOptionalColumns, omitKeys } from "../optional-columns";
import { getStoredTenantKey, setStoredTenantKey, clearStoredTenantKey } from "../tenant-storage";

describe("JSON editor schema docs", () => {
  it("restricts rooms and color schemes to known ids", () => {
    const doc = entriesJsonSchemaDoc(["main"], ["red"]);
    const p = doc.properties.entries.items.properties;
    expect(p.rooms.items).toEqual({ type: "string", enum: ["main"] });
    expect(p.color_scheme).toMatchObject({ enum: ["red", null] });
  });
  it("falls back to free text when nothing is configured", () => {
    const p = entriesJsonSchemaDoc([], []).properties.entries.items.properties;
    expect(p.rooms.items).toMatchObject({ minLength: 1 });
    expect("enum" in p.color_scheme).toBe(false);
  });
  it("teams schema lists rooms or leaves them open", () => {
    expect(teamsJsonSchemaDoc(["a"]).properties.teams.items.properties.room).toMatchObject({
      enum: ["a", null],
    });
    expect("enum" in teamsJsonSchemaDoc([]).properties.teams.items.properties.room).toBe(false);
  });
  it("snippets contain the example time and placeholders", () => {
    expect(entrySnippetBody("2026-01-01T10:00:00+01:00")).toContain("2026-01-01T10:00:00+01:00");
    expect(teamSnippetBody()).toContain("New team");
  });
});

describe("optional columns", () => {
  it("recognises missing-column errors in all formats", () => {
    expect(isMissingColumnError({ message: 'column "x" does not exist' })).toBe(true);
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ message: "Could not find the 'x' column of 'y'" })).toBe(true);
    expect(isMissingColumnError("column y does not exist")).toBe(true);
    expect(isMissingColumnError({ message: "permission denied" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
  it("retries without columns only on missing-column errors", async () => {
    const fallback = vi.fn().mockResolvedValue({ data: "old", error: null });
    expect(
      await withOptionalColumns(async () => ({ data: null, error: { code: "42703" } }), fallback),
    ).toEqual({ data: "old", error: null });
    const r = await withOptionalColumns(
      async () => ({ data: null, error: { message: "denied" } }),
      fallback,
    );
    expect(r.error).toEqual({ message: "denied" });
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("omits keys without touching the original", () => {
    const src = { a: 1, b: 2 };
    expect(omitKeys(src, ["b"])).toEqual({ a: 1 });
    expect(src).toEqual({ a: 1, b: 2 });
  });
});

describe("remembered organization key", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("is a no-op on the server", () => {
    expect(getStoredTenantKey()).toBeNull();
    expect(() => setStoredTenantKey("x")).not.toThrow();
  });
  it("stores, reads and clears in the browser", () => {
    const m = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => m.set(k, v),
        removeItem: (k: string) => m.delete(k),
      },
    });
    setStoredTenantKey("acme");
    expect(getStoredTenantKey()).toBe("acme");
    clearStoredTenantKey();
    expect(getStoredTenantKey()).toBeNull();
  });
  it("survives blocked storage", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(getStoredTenantKey()).toBeNull();
    expect(() => setStoredTenantKey("a")).not.toThrow();
    expect(() => clearStoredTenantKey()).not.toThrow();
  });
});
