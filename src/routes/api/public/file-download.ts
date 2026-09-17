import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a stored file for a short lived signed token. The browser never sees
 * a provider URL, so the storage layer stays exchangeable.
 */
export const Route = createFileRoute("/api/public/file-download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("t");
        if (!token) return new Response("Missing token", { status: 400 });

        const { readFileToken } = await import("@/lib/files.server");
        const ref = await readFileToken(token);
        if (!ref) return new Response("Invalid or expired token", { status: 403 });

        const { fileStorage } = await import("@/lib/storage/index.server");
        const object = await fileStorage().get(ref.k);
        if (!object) return new Response("Not found", { status: 404 });

        const safeName = ref.n.replace(/[\r\n"]/g, "_");
        return new Response(object.bytes as unknown as BodyInit, {
          headers: {
            "content-type": ref.ct || object.contentType,
            "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(ref.n)}`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
