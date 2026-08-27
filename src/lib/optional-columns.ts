/**
 * Some columns are introduced by a migration that is only applied when the
 * current draft is accepted. Until then the live database still lacks them, and
 * a plain select referencing them fails the whole admin view with
 * `column x does not exist`. These helpers let reads/writes degrade gracefully:
 * try with the new columns, and on a missing-column error retry without them.
 */

export function isMissingColumnError(error: unknown): boolean {
  if (!error) return false;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);
  return /column .* does not exist/i.test(message) || /42703/.test(message);
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
