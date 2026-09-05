import { getBackendAdmin } from "@/lib/backend/admin.server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/ad/$tenantKey/$adId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, adId } = params;
        const supabaseAdmin = await getBackendAdmin();

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: ad } = await supabaseAdmin
          .from("ads")
          .select("path, content_type")
          .eq("id", adId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!ad) return new Response("Not found", { status: 404 });

        const { data, error } = await supabaseAdmin.storage.from("tenant-ads").download(ad.path);
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": ad.content_type || data.type || "image/png",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
