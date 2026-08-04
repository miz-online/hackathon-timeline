// Human readable, stable-ish identifiers used by the import/export format.
// A referencable object (room, color scheme) may carry an explicit `ref_id`.
// When it is empty, the id is derived from the object name, so renaming an
// object also changes its id.

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
  å: "a",
  ø: "o",
  æ: "ae",
  é: "e",
  è: "e",
  ê: "e",
  á: "a",
  à: "a",
  â: "a",
  í: "i",
  ì: "i",
  ó: "o",
  ò: "o",
  ú: "u",
  ù: "u",
  ç: "c",
  ñ: "n",
};

export function slugify(input: string): string {
  const mapped = Array.from(input ?? "")
    .map((c) => UMLAUTS[c] ?? c)
    .join("");
  const slug = mapped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug;
}

/** The id that is actually used for references. */
export function effectiveRefId(item: { ref_id?: string | null; name: string }): string {
  const explicit = (item.ref_id ?? "").trim();
  return explicit ? slugify(explicit) : slugify(item.name);
}

/** Make ids unique by appending -2, -3, ... Falls back to `fallback` for empty ids. */
export function uniqueRefId(candidate: string, taken: Set<string>, fallback = "item"): string {
  const base = candidate || fallback;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  const out = `${base}-${n}`;
  taken.add(out);
  return out;
}

/** Compute unique effective ids for a list, preserving order. */
export function refIdsFor(items: { ref_id?: string | null; name: string }[]): string[] {
  const taken = new Set<string>();
  return items.map((i) => uniqueRefId(effectiveRefId(i), taken, "item"));
}
