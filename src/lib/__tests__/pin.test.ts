import { describe, it, expect, vi } from "vitest";
vi.mock("@tanstack/react-start/server", () => ({ useSession: vi.fn() }));
import { hashPin, verifyPin } from "../tenant-auth.server";

describe("PIN hashing", () => {
  it("never stores the PIN in plain text and verifies it", async () => {
    const h = await hashPin("1234");
    expect(h).not.toContain("1234");
    expect(await verifyPin("1234", h)).toBe(true);
    expect(await verifyPin("4321", h)).toBe(false);
  });
  it("uses a random salt", async () => {
    expect(await hashPin("0000")).not.toBe(await hashPin("0000"));
  });
  it("rejects when no PIN is stored or hash is garbage", async () => {
    expect(await verifyPin("1234", null)).toBe(false);
    expect(await verifyPin("1234", "garbage")).toBe(false);
  });
});
