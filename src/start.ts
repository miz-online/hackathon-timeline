import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// Intentionally replaces the generated attachSupabaseAuth: it must not run in
// the self-hosted variant, which has no Cloud environment variables.
import { attachAuthIfAvailable } from "@/lib/backend/auth-attach";
import { isTenantLockedError } from "@/lib/tenant-lock";


const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // An expired tenant PIN session is an expected authorization state. Keep
    // its structured 401 response intact so the client can show the PIN gate;
    // never turn it into the generic HTML 500 page.
    if (isTenantLockedError(error)) throw error;
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachAuthIfAvailable],
  requestMiddleware: [errorMiddleware],
}));
