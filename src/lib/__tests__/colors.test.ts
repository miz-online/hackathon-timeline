import { describe, it, expect } from "vitest";
import { normalizeHex, hexToRgb, DEFAULT_ACCENT, luminance } from "../colors";

describe("colors", () => {
  it("normalizes short and invalid hex", () => {
    expect(normalizeHex("abc")).toBe("#AABBCC");
    expect(normalizeHex("nope")).toBe(DEFAULT_ACCENT);
  });
  it("parses rgb", () => expect(hexToRgb("#102030")).toEqual({ r: 16, g: 32, b: 48 }));
  it("luminance bounds", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
  });
});
