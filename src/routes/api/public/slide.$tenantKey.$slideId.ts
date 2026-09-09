import { getBackendAdmin } from "@/lib/backend/admin.server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/slide/$tenantKey/$slideId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, slideId } = params;
        const supabaseAdmin = await getBackendAdmin();

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: slide } = await supabaseAdmin
          .from("slides")
          .select("path, content_type")
          .eq("id", slideId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!slide) return new Response("Not found", { status: 404 });

        const { data, error } = await supabaseAdmin.storage.from("tenant-ads").download(slide.path);
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": slide.content_type || data.type || "image/png",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
