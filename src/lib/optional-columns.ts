/**
 * Some columns are introduced by a migration that is only applied when the
 * current draft is accepted. Until then the live database still lacks them, and
 * a plain select referencing them fails the whole admin view with
 * `column x does not exist`. These helpers let reads/writes degrade gracefully:
 * try with the new columns, and on a missing-column error retry without them.
 */

export function isMissingColumnError(error: unknown): boolean {
  if (!error) return false;
  const obj = (typeof error === "object" && error !== null ? error : {}) as {
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const text = [obj.message, obj.code, obj.details, obj.hint]
    .filter((v) => v != null)
    .map(String)
    .join(" ")
    .concat(typeof error === "object" ? "" : ` ${String(error)}`);
  return (
    /column .* does not exist/i.test(text) ||
    /42703/.test(text) ||
    /PGRST204/.test(text) ||
    // PostgREST write path: "Could not find the 'x' column of 'y' in the schema cache"
    /could not find the '.*' column/i.test(text)
  );
}


/** Runs `attempt`, falling back to `withoutColumns` when a column is missing. */
export async function withOptionalColumns<T>(
  attempt: () => Promise<{ data: T; error: unknown }>,
  withoutColumns: () => Promise<{ data: T; error: unknown }>,
): Promise<{ data: T; error: unknown }> {
  const first = await attempt();
  if (first.error && isMissingColumnError(first.error)) return withoutColumns();
  return first;
}

/** Removes keys from a payload (used to drop not-yet-existing columns). */
export function omitKeys<T extends Record<string, unknown>>(
  payload: T,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const k of keys) delete out[k];
  return out;
}
