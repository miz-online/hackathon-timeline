/**
 * In-process change bus used by the self-hosted variant to replace Cloud's
 * database change streams. Every write through the SQLite adapter publishes
 * here; the SSE route subscribes.
 */

export type ChangeEvent = { table: string; tenantId: string | null };
type Listener = (event: ChangeEvent) => void;

const listeners = new Set<Listener>();
const hooks = new Set<Listener>();

export function publishChange(event: ChangeEvent): void {
  for (const l of [...listeners, ...hooks]) {
    try {
      l(event);
    } catch {
      /* a broken listener must not break the write */
    }
  }
}

export function subscribeChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Internal subscribers (e.g. the webhook scheduler) that outlive requests. */
export function onChangeInternal(listener: Listener): void {
  hooks.add(listener);
}
