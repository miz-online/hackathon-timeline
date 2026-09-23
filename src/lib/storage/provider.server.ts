/**
 * Provider-agnostic file storage contract.
 *
 * The application only ever talks to this interface and only ever stores
 * *logical keys* (e.g. `<tenant_id>/team/<team_id>/<uuid>.pdf`) in the
 * database — never a provider path, bucket name or URL. Adding another
 * provider (S3, SharePoint, Dropbox, …) means adding one file plus one
 * registry entry in `index.server.ts`; no application code changes.
 */
export type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

export interface FileStorageProvider {
  /** Stable provider id, used by the registry and for diagnostics. */
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  remove(keys: string[]): Promise<void>;
  list(prefix: string): Promise<{ key: string }[]>;
  /** Optional direct URL; providers without one return null and we stream instead. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}
