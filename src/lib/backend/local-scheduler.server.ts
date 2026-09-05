import { onChangeInternal } from "./events.server";
import { getDb } from "./sqlite-db.server";

const WATCHED = new Set(["entries", "teams", "webhooks", "tenants"]);
const MAX_DELAY_MS = 60 * 60 * 1000; // re-check hourly at the latest

let timer: ReturnType<typeof setTimeout> | undefined;
let armed = false;

type Row = Record<string, unknown>;

/** Earliest moment at which any tenant has a due, un-notified slot. */
async function computeNextDispatch(): Promise<string | null> {
  const db = await getDb();
  const tenants = db
    .prepare(
      `select t.id, t.past_grace_minutes, t.practice_minutes, t.practice_room_scope
         from tenants t
        where exists (select 1 from webhooks w where w.tenant_id = t.id and w.enabled = 1)`,
    )
    .all() as Row[];

  let best: number | null = null;
  const now = Date.now();

  for (const tenant of tenants) {
    const tenantId = String(tenant["id"]);
    const grace = Number(tenant["past_grace_minutes"] ?? 15) * 60 * 1000;
    const practiceMinutes = Number(tenant["practice_minutes"] ?? 10);
    const teamCount = (
      db.prepare(`select count(*) as c from teams where tenant_id = ?`).all(tenantId) as Row[]
    ).map((r) => Number(r["c"]))[0] ?? 0;

    const entries = db
      .prepare(
        `select id, kind, time, notified_at, notified_teams from entries
          where tenant_id = ? and notify = 1`,
      )
      .all(tenantId) as Row[];

    for (const entry of entries) {
      const start = new Date(String(entry["time"])).getTime();
      if (!Number.isFinite(start)) continue;
      if (String(entry["kind"]) === "practice") {
        let notified: string[] = [];
        try {
          const parsed = JSON.parse(String(entry["notified_teams"] ?? "[]"));
          if (Array.isArray(parsed)) notified = parsed.map(String);
        } catch {
          notified = [];
        }
        for (let i = 0; i < teamCount; i++) {
          const slot = start + i * practiceMinutes * 60 * 1000;
          if (slot < now - grace) continue;
          if (notified.length > i) continue;
          if (best === null || slot < best) best = slot;
        }
      } else {
        if (entry["notified_at"]) continue;
        if (start < now - grace) continue;
        if (best === null || start < best) best = start;
      }
    }
  }

  return best === null ? null : new Date(best).toISOString();
}

async function dispatchNow(): Promise<void> {
  const base = process.env["PUBLIC_BASE_URL"] || `http://127.0.0.1:${process.env["PORT"] || 3000}`;
  try {
    await fetch(`${base}/api/public/webhooks-dispatch`, { method: "POST" });
  } catch (error) {
    console.error("[local-scheduler] dispatch failed", error);
  }
}

async function arm(): Promise<string | null> {
  const next = await computeNextDispatch();
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!next) return null;
  const delay = Math.min(Math.max(new Date(next).getTime() - Date.now(), 0), MAX_DELAY_MS);
  timer = setTimeout(() => {
    void dispatchNow().then(() => arm());
  }, delay);
  return next;
}

/** Cloud-compatible RPC surface for the self-hosted variant. */
export async function runLocalRpc(name: string): Promise<{ data: unknown; error: null }> {
  ensureStarted();
  if (name === "next_webhook_dispatch_at") return { data: await computeNextDispatch(), error: null };
  if (name === "reschedule_webhook_dispatch") return { data: await arm(), error: null };
  return { data: null, error: null };
}

export function ensureStarted(): void {
  if (armed) return;
  armed = true;
  onChangeInternal((event) => {
    if (WATCHED.has(event.table)) void arm();
  });
  void arm();
}
