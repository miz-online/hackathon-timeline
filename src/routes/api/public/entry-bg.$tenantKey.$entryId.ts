import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/entry-bg/$tenantKey/$entryId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, entryId } = params;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: entry } = await supabaseAdmin
          .from("entries")
          .select("background_path, background_content_type")
          .eq("id", entryId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!entry?.background_path) return new Response("Not found", { status: 404 });

        const { data, error } = await supabaseAdmin.storage
          .from("tenant-entry-backgrounds")
          .download(entry.background_path);
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": entry.background_content_type || data.type || "image/png",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
