import { createMiddleware } from "@tanstack/react-start";

/**
 * Replaces the generated attachSupabaseAuth so the self-hosted variant works
 * without any Cloud environment variables: when they are absent we simply
 * forward the call without a bearer token.
 */
export const attachAuthIfAvailable = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const hasCloud = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!hasCloud) return next({ headers: {} });
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    return next({ headers: {} });
  }
});
