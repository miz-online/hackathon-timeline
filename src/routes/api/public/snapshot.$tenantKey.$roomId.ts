import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/snapshot/$tenantKey/$roomId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, roomId } = params;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("id, name, past_grace_minutes, template, logo_url, logo_height")
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: room } = await supabaseAdmin
          .from("rooms")
          .select("id, name")
          .eq("id", roomId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!room) return new Response("Not found", { status: 404 });

        const { data: entries } = await supabaseAdmin
          .from("entries")
          .select("id, time, title, description, tags")
          .eq("tenant_id", tenant.id);

        const cutoff = Date.now() - tenant.past_grace_minutes * 60 * 1000;
        const visible = (entries ?? [])
          .filter((e) => new Date(e.time).getTime() >= cutoff)
          .filter((e) => e.tags.length === 0 || e.tags.includes(room.name))
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        return new Response(
          JSON.stringify({
            tenant: {
              name: tenant.name,
              past_grace_minutes: tenant.past_grace_minutes,
              template: tenant.template,
              logo_url: tenant.logo_url,
              logo_height: tenant.logo_height,
            },
            room,
            entries: visible,
          }),
          { headers: { "content-type": "application/json", "cache-control": "no-store" } },
        );
      },
    },
  },
});
