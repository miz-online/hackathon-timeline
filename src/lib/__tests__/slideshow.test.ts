import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/backend/admin.server", () => ({}));
vi.mock("@/lib/storage/index.server", () => ({}));
import { resolveAutoTemplate } from "../slides.server";

const T = (h: number) => `2026-01-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const now = new Date(T(10)).getTime();
const show = (id: string, s: number, e: number, tags: string[] = []) => ({ kind: "slides", time: T(s), end_time: T(e), tags, slide_set_id: id });
const run = (entries: ReturnType<typeof show>[], roomName = "A") =>
  resolveAutoTemplate({ template: "auto", entries, roomName, isOverview: false, now });

describe("automatic display mode", () => {
  it("keeps manual templates", () => {
    expect(resolveAutoTemplate({ template: "zeitplan", entries: [], roomName: "A", isOverview: false })).toEqual({ template: "zeitplan", switchAt: null });
  });
  it("shows entries when no slideshow is active, switching at next start", () => {
    expect(run([show("s1", 11, 12)])).toEqual({ template: "zeitplan", switchAt: T(11) });
  });
  it("plays the active slideshow until its end", () => {
    expect(run([show("s1", 9, 11)])).toEqual({ template: "slides:s1", switchAt: T(11) });
  });
  it("later start wins on overlap", () => {
    expect(run([show("s1", 8, 12), show("s2", 9, 11)]).template).toBe("slides:s2");
  });
  it("respects room tags", () => {
    expect(run([show("s1", 9, 11, ["B"])]).template).toBe("zeitplan");
    expect(run([show("s1", 9, 11, ["A"])]).template).toBe("slides:s1");
  });
});
