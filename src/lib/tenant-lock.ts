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

export class TenantLockedError extends Error {
  readonly statusCode = 401;

  constructor() {
    super(TENANT_LOCKED_CODE);
    this.name = "TenantLockedError";
  }
}

export function isTenantLockedError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(TENANT_LOCKED_CODE);
}

export function notifyTenantLocked(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Admin list queries can be refreshed after the sliding PIN session expires.
 * Treat that expected response as a UI state change rather than an uncaught
 * request error; all other failures still reach React Query normally.
 */
export async function runTenantAdminQuery<T>(query: () => Promise<T>): Promise<T | undefined> {
  try {
    return await query();
  } catch (error) {
    if (!isTenantLockedError(error)) throw error;
    notifyTenantLocked();
    return undefined;
  }
}

export function onTenantLocked(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
