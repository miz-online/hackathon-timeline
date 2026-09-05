import { dataDir } from "./sqlite-db.server";

const TOKEN_TTL_FALLBACK = 3600;

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

/** Creates a short-lived token for a local file, mirroring signed URLs. */
export async function createLocalFileToken(bucket: string, path: string, expiresIn: number): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ bucket, path, exp: Date.now() + expiresIn * 1000 })));
  return `${payload}.${await sign(payload)}`;
}

export async function readLocalFileToken(token: string): Promise<{ bucket: string; path: string } | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if ((await sign(payload)) !== sig) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      bucket: string;
      path: string;
      exp: number;
    };
    if (decoded.exp < Date.now()) return null;
    return { bucket: decoded.bucket, path: decoded.path };
  } catch {
    return null;
  }
}

async function nodeFs() {
  const fs = await import(/* @vite-ignore */ "node:fs/promises");
  const path = await import(/* @vite-ignore */ "node:path");
  return { fs, path };
}

function safeJoin(pathMod: { join: (...p: string[]) => string; normalize: (p: string) => string }, ...parts: string[]) {
  const joined = pathMod.normalize(pathMod.join(...parts));
  if (joined.includes("..")) throw new Error("Invalid path");
  return joined;
}

function bucketRoot(pathMod: { join: (...p: string[]) => string }, bucket: string) {
  return pathMod.join(dataDir(), "storage", bucket);
}

export function localStorageApi() {
  return {
    from(bucket: string) {
      return {
        async upload(objectPath: string, body: ArrayBuffer | Uint8Array | Blob, _opts?: unknown) {
          const { fs, path } = await nodeFs();
          const target = safeJoin(path, bucketRoot(path, bucket), objectPath);
          await fs.mkdir(path.dirname(target), { recursive: true });
          const bytes =
            body instanceof Blob
              ? new Uint8Array(await body.arrayBuffer())
              : body instanceof Uint8Array
                ? body
                : new Uint8Array(body);
          await fs.writeFile(target, bytes);
          return { data: { path: objectPath }, error: null };
        },
        async download(objectPath: string) {
          const { fs, path } = await nodeFs();
          try {
            const bytes = await fs.readFile(safeJoin(path, bucketRoot(path, bucket), objectPath));
            return { data: new Blob([new Uint8Array(bytes)]), error: null };
          } catch {
            return { data: null, error: { message: "Object not found" } };
          }
        },
        async remove(paths: string[]) {
          const { fs, path } = await nodeFs();
          for (const p of paths) {
            try {
              await fs.unlink(safeJoin(path, bucketRoot(path, bucket), p));
            } catch {
              /* already gone */
            }
          }
          return { data: null, error: null };
        },
        async list(prefix = "") {
          const { fs, path } = await nodeFs();
          try {
            const entries = await fs.readdir(safeJoin(path, bucketRoot(path, bucket), prefix), {
              withFileTypes: true,
            });
            return { data: entries.filter((e) => e.isFile()).map((e) => ({ name: e.name })), error: null };
          } catch {
            return { data: [], error: null };
          }
        },
        async createSignedUrl(objectPath: string, expiresIn = TOKEN_TTL_FALLBACK) {
          const token = await createLocalFileToken(bucket, objectPath, expiresIn);
          return { data: { signedUrl: `/api/public/file?t=${encodeURIComponent(token)}` }, error: null };
        },
        async createSignedUrls(paths: string[], expiresIn = TOKEN_TTL_FALLBACK) {
          const data = await Promise.all(
            paths.map(async (p) => ({
              path: p,
              signedUrl: `/api/public/file?t=${encodeURIComponent(await createLocalFileToken(bucket, p, expiresIn))}`,
              error: null,
            })),
          );
          return { data, error: null };
        },
        getPublicUrl(objectPath: string) {
          return { data: { publicUrl: `/api/public/file/raw/${bucket}/${objectPath}` } };
        },
      };
    },
  };
}
