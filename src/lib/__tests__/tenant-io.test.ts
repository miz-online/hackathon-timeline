import { describe, it, expect } from "vitest";
import { tenantDataSchema } from "../tenant-io";

describe("tenant import schema", () => {
  it("accepts partial files and applies defaults", () => {
    const r = tenantDataSchema.parse({ entries: [{ time: "2026-01-01T10:00:00Z", title: "Start" }] });
    expect(r.entries?.[0]).toMatchObject({ kind: "entry", notify: true, rooms: [] });
  });
  it("rejects bad colors and unknown slide kinds", () => {
    expect(tenantDataSchema.safeParse({ color_schemes: [{ id: "x", name: "X", color: "red" }] }).success).toBe(false);
    expect(tenantDataSchema.safeParse({ slides: [{ name: "s", kind: "video" }] }).success).toBe(false);
  });
});
