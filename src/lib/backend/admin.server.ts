/**
 * Backend driver selection. BACKEND=cloud (default) uses Lovable Cloud;
 * BACKEND=local uses the self-contained SQLite + filesystem driver.
 * All server-side data access goes through getBackendAdmin().
 */
import type { supabaseAdmin as CloudAdmin } from "@/integrations/supabase/client.server";

export type BackendAdmin = typeof CloudAdmin;

export function isLocalBackend(): boolean {
  return (process.env["BACKEND"] || "cloud").toLowerCase() === "local";
}

let localClient: unknown;

export async function getBackendAdmin(): Promise<BackendAdmin> {
  if (isLocalBackend()) {
    if (!localClient) {
      const [{ createLocalClient }, { ensureStarted }] = await Promise.all([
        import("./sqlite-client.server"),
        import("./local-scheduler.server"),
      ]);
      localClient = createLocalClient();
      ensureStarted();
    }
    return localClient as BackendAdmin;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
