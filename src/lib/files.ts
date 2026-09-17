/** Shared, browser-safe constants for the file feature. */

/**
 * How the file feature behaves for an organization:
 * - "off": no file management at all
 * - "download": teams may only download the organization's files
 * - "full": teams may upload, download and delete their own files
 */
export const FILE_MODES = ["off", "download", "full"] as const;
export type FileMode = (typeof FILE_MODES)[number];

export function normalizeFileMode(value: unknown): FileMode {
  return FILE_MODES.includes(value as FileMode) ? (value as FileMode) : "full";
}

export type FileItem = {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
