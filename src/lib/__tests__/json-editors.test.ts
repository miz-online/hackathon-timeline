import { describe, it, expect } from "vitest";
import { teamsJsonSchema } from "../teams-json";
import { localIsoNow } from "../entries-json";

describe("teams JSON editor", () => {
  it("allows new teams without id and fills defaults", () => {
    const r = teamsJsonSchema.parse({ teams: [{ name: "Rockets" }] });
    expect(r.teams[0]).toMatchObject({ name: "Rockets", members: "", project: "" });
  });
  it("rejects empty names and invalid ids", () => {
    expect(teamsJsonSchema.safeParse({ teams: [{ name: "" }] }).success).toBe(false);
    expect(teamsJsonSchema.safeParse({ teams: [{ id: "1", name: "x" }] }).success).toBe(false);
  });
});

describe("local time stamp", () => {
  it("has date, minutes and zone offset", () => {
    expect(localIsoNow(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
  });
});
