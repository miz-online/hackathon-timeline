/**
 * Provider registry for file storage. Application code only calls
 * `fileStorage()` and only ever handles logical keys, so a new provider
 * (S3, SharePoint, Dropbox, …) is a single file plus one entry here.
 */
import type { FileStorageProvider, StoredObject } from "./provider.server";

/** Logical container; the backend maps it to a bucket or a directory. */
const CONTAINER = "tenant-files";

/**
 * Default provider: the configured backend (Lovable Cloud bucket in the hosted
 * variant, local filesystem in the self-hosted container).
 */
function backendProvider(): FileStorageProvider {
  const api = async () => {
    const { getBackendAdmin } = await import("@/lib/backend/admin.server");
    const admin = await getBackendAdmin();
    return admin.storage.from(CONTAINER);
  };
  return {
    name: "backend",
    async put(key, bytes, contentType) {
      const { error } = await (await api()).upload(key, bytes, { contentType, upsert: true });
      if (error) throw new Error(error.message);
    },
    async get(key): Promise<StoredObject | null> {
      const { data } = await (await api()).download(key);
      if (!data) return null;
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
    },
    async remove(keys) {
      if (!keys.length) return;
      await (await api()).remove(keys);
    },
    async list(prefix) {
      const { data } = await (await api()).list(prefix);
      return (data ?? []).map((o: { name: string }) => ({ key: `${prefix}/${o.name}` }));
    },
    async signedUrl() {
      // Downloads always stream through our own route so access checks apply.
      return null;
    },
  };
}

const REGISTRY: Record<string, () => FileStorageProvider> = {
  backend: backendProvider,
  cloud: backendProvider,
  local: backendProvider,
};

export function fileStorage(): FileStorageProvider {
  const id = (process.env["FILE_STORAGE"] || "backend").toLowerCase();
  return (REGISTRY[id] ?? backendProvider)();
}

/** Logical key for a team file. Never a provider path or URL. */
export function teamFileKey(tenantId: string, teamId: string, ext: string): string {
  return `${tenantId}/team/${teamId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
}

/** Logical key for an organization-wide download. */
export function tenantFileKey(tenantId: string, ext: string): string {
  return `${tenantId}/global/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
}
