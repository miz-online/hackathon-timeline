import { describe, it, expect } from "vitest";
import { slugify, effectiveRefId, refIdsFor } from "../ref-id";

describe("reference ids", () => {
  it("slugifies umlauts and symbols", () => {
    expect(slugify("  Größe & Übung! ")).toBe("groesse-uebung");
  });
  it("prefers explicit ref_id", () => {
    expect(effectiveRefId({ ref_id: "My Id", name: "x" })).toBe("my-id");
  });
  it("makes duplicates unique and fills empty ids", () => {
    expect(refIdsFor([{ name: "Raum" }, { name: "Raum" }, { name: "!!" }])).toEqual(["raum", "raum-2", "item"]);
  });
});
