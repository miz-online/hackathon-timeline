import { useSession } from "@tanstack/react-start/server";

const MAX_AGE_SECONDS = 60 * 60 * 4; // 4 hours sliding window
// The deployed edge runtime rejects PBKDF2 above 100k iterations, so anything
// higher throws at runtime (while Node in dev happily computes it).
const MAX_ITERATIONS = 100_000;
const ITERATIONS = MAX_ITERATIONS;

type TenantSession = { tenants?: string[] };

function sessionConfig() {
  const password = process.env["SESSION_SECRET"];
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "tenant-admin",
    maxAge: MAX_AGE_SECONDS,
    cookie: {
      httpOnly: true,
      secure: true,
      // The editor preview renders the app inside a cross-site iframe, where
      // SameSite=Lax cookies are never sent. None + Partitioned keeps the
      // session working both standalone and embedded.
      sameSite: "none" as const,
      partitioned: true,
      path: "/",
    },
  };
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const expected = fromB64(parts[3]!);
  const actual = await derive(pin, fromB64(parts[2]!), iterations);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ actual[i]!;
  return diff === 0;
}

async function session() {
  return useSession<TenantSession>(sessionConfig());
}

/** Marks a tenant as unlocked and refreshes the sliding expiry. */
export async function markTenantUnlocked(tenantId: string): Promise<void> {
  const s = await session();
  const current = s.data.tenants ?? [];
  const next = current.includes(tenantId) ? current : [...current, tenantId];
  await s.update({ tenants: next });
}

/** Returns true when the tenant is unlocked; refreshes the cookie on each call. */
export async function isTenantUnlocked(tenantId: string): Promise<boolean> {
  const s = await session();
  const tenants = s.data.tenants ?? [];
  if (!tenants.includes(tenantId)) return false;
  await s.update({ tenants }); // sliding expiry refresh
  return true;
}

export async function lockTenant(tenantId: string): Promise<void> {
  const s = await session();
  const tenants = (s.data.tenants ?? []).filter((id) => id !== tenantId);
  if (tenants.length === 0) await s.clear();
  else await s.update({ tenants });
}
