import { describe, it, expect } from "vitest";
import { expandPracticeEntries, practiceEndTime } from "../practice";

const base = { id: "p", kind: "practice", time: "2026-01-01T10:00:00.000Z", end_time: null, title: "Übungszeit", description: "", tags: [], color: "#111111" };
const teams = [
  { id: "a", name: "A", room_id: "r1", color: "#AA0000" },
  { id: "b", name: "B", room_id: "r2", color: null },
];

describe("practice", () => {
  it("computes end time from team count", () => {
    expect(practiceEndTime(base.time, 3, 10)).toBe("2026-01-01T10:30:00.000Z");
  });
  it("expands one slot per team in order", () => {
    const out = expandPracticeEntries([base], { teams, practiceMinutes: 15, scope: "all", roomId: "r1", isOverview: false });
    expect(out.map((e) => [e.title, e.time, e.color])).toEqual([
      ["A", "2026-01-01T10:00:00.000Z", "#AA0000"],
      ["B", "2026-01-01T10:15:00.000Z", "#111111"],
    ]);
  });
  it("hides other rooms' teams without shifting slots", () => {
    const out = expandPracticeEntries([base], { teams, practiceMinutes: 15, scope: "assigned", roomId: "r2", isOverview: false });
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe("2026-01-01T10:15:00.000Z");
  });
  it("leaves normal entries untouched", () => {
    const e = { ...base, kind: "entry" };
    expect(expandPracticeEntries([e], { teams, practiceMinutes: 10, scope: "all", roomId: "x", isOverview: true })).toEqual([e]);
  });
});
