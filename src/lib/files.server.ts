/**
 * Server-only helpers for the file feature: short lived download tokens and
 * tenant resolution. Downloads always stream through our own route, so no
 * provider URL ever reaches the browser.
 */
import { normalizeFileMode, type FileMode } from "@/lib/files";

export type FileTokenPayload = {
  /** Logical storage key (provider agnostic). */
  k: string;
  /** Original file name, used for Content-Disposition. */
  n: string;
  ct: string;
  exp: number;
};

function secret(): string {
  return process.env["SESSION_SECRET"] || "local-dev-secret";
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(sig));
}

export async function signFileToken(
  data: Omit<FileTokenPayload, "exp">,
  ttlSeconds = 300,
): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ ...data, exp: Date.now() + ttlSeconds * 1000 })),
  );
  return `${payload}.${await sign(payload)}`;
}

export async function readFileToken(token: string): Promise<FileTokenPayload | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if ((await sign(payload)) !== sig) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as FileTokenPayload;
    if (decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Token for a bulk ZIP download of team files. */
export type ZipTokenPayload = {
  /** Tenant the files belong to. */
  t: string;
  /** Selected team file ids; empty means "all team files of the tenant". */
  ids: string[];
  exp: number;
};

export async function signZipToken(
  data: Omit<ZipTokenPayload, "exp">,
  ttlSeconds = 300,
): Promise<string> {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ ...data, exp: Date.now() + ttlSeconds * 1000 })),
  );
  return `${payload}.${await sign(payload)}`;
}

export async function readZipToken(token: string): Promise<ZipTokenPayload | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if ((await sign(payload)) !== sig) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as ZipTokenPayload;
    if (decoded.exp < Date.now() || !decoded.t) return null;
    return decoded;
  } catch {
    return null;
  }
}

export type TenantFileConfig = {
  id: string;
  filesMode: FileMode;
  maxUploadMb: number;
  /** Total storage per team in MB; 0 = unlimited. */
  teamQuotaMb: number;
  teamEditLocked: boolean;
};

export async function tenantFileConfig(tenantId: string): Promise<TenantFileConfig> {
  const { getBackendAdmin } = await import("@/lib/backend/admin.server");
  const admin = await getBackendAdmin();
  const { data } = await admin
    .from("tenants")
    .select("id, files_mode, max_upload_mb, team_quota_mb, team_edit_locked")
    .eq("id", tenantId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    files_mode: string | null;
    max_upload_mb: number | null;
    team_quota_mb: number | null;
    team_edit_locked: boolean | null;
  } | null;
  if (!row) throw new Error("Unknown tenant");
  return {
    id: row.id,
    filesMode: normalizeFileMode(row.files_mode),
    maxUploadMb: row.max_upload_mb ?? 10,
    teamQuotaMb: row.team_quota_mb ?? 0,
    teamEditLocked: row.team_edit_locked === true,
  };
}

/** Admin-scoped tenant resolution by key, including the PIN session check. */
export async function requireFileAdmin(key: string): Promise<TenantFileConfig> {
  const { getBackendAdmin } = await import("@/lib/backend/admin.server");
  const admin = await getBackendAdmin();
  const { data } = await admin
    .from("tenants")
    .select("id, pin_hash")
    .eq("key", key)
    .maybeSingle();
  const row = data as unknown as { id: string; pin_hash: string | null } | null;
  if (!row) throw new Error("Unknown tenant key");
  if (row.pin_hash) {
    const { isTenantUnlocked } = await import("@/lib/tenant-auth.server");
    if (!(await isTenantUnlocked(row.id))) throw new Error("TENANT_LOCKED");
  }
  return tenantFileConfig(row.id);
}

export function decodeBase64(data: string): Uint8Array {
  const raw = atob(data.includes(",") ? data.split(",").pop()! : data);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function extensionOf(filename: string): string {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  return (parts.pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
}

/** Throws when adding `extraBytes` would exceed the team's storage quota. */
export async function assertTeamQuota(
  cfg: TenantFileConfig,
  teamId: string,
  extraBytes: number,
): Promise<void> {
  if (!cfg.teamQuotaMb || cfg.teamQuotaMb <= 0) return;
  const { getBackendAdmin } = await import("@/lib/backend/admin.server");
  const admin = await getBackendAdmin();
  const { data } = await admin
    .from("team_files")
    .select("size_bytes")
    .eq("team_id" as never, teamId as never);
  const used = ((data ?? []) as { size_bytes: number | null }[]).reduce(
    (sum, r) => sum + (r.size_bytes ?? 0),
    0,
  );
  if (used + extraBytes > cfg.teamQuotaMb * 1024 * 1024)
    throw new Error(`Team storage limit of ${cfg.teamQuotaMb} MB reached`);
}
