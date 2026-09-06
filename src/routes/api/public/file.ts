import { createFileRoute } from "@tanstack/react-router";

/**
 * Serves files from the local data volume for short-lived signed tokens.
 * Only used by the self-hosted variant (BACKEND=local).
 */
export const Route = createFileRoute("/api/public/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { isLocalBackend } = await import("@/lib/backend/admin.server");
        if (!isLocalBackend()) return new Response("Not found", { status: 404 });

        const token = new URL(request.url).searchParams.get("t");
        if (!token) return new Response("Missing token", { status: 400 });

        const { readLocalFileToken, localStorageApi } = await import("@/lib/backend/local-storage.server");
        const ref = await readLocalFileToken(token);
        if (!ref) return new Response("Invalid or expired token", { status: 403 });

        const { data, error } = await localStorageApi().from(ref.bucket).download(ref.path);
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "private, max-age=60",
          },
        });
      },
    },
  },
});
