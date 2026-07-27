import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/logo/$tenantKey")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey } = params;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("logo_url")
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant?.logo_url) return new Response("Not found", { status: 404 });

        const { data, error } = await supabaseAdmin.storage
          .from("tenant-logos")
          .download(tenant.logo_url);
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": data.type || "image/png",
            "cache-control": "public, max-age=60",
          },
        });
      },
    },
  },
});
