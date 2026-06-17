const KEY = "roomboard.tenantKey";

export function getStoredTenantKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredTenantKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, key);
  } catch {
    /* ignore */
  }
}

export function clearStoredTenantKey() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
