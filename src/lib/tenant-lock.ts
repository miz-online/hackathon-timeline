/**
 * Detection + broadcast for "the tenant admin session is locked".
 *
 * Every admin server function calls `requireTenantAdmin`, which throws
 * `TENANT_LOCKED` when the 4h session cookie is missing or expired. Any query
 * or mutation hitting that error broadcasts here so the admin UI can drop back
 * to the PIN gate immediately instead of waiting for the next access poll.
 */

export const TENANT_LOCKED_CODE = "TENANT_LOCKED";
const EVENT = "tenant-locked";

export function isTenantLockedError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(TENANT_LOCKED_CODE);
}

export function notifyTenantLocked(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function onTenantLocked(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
