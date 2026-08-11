import { createFileRoute } from "@tanstack/react-router";
import { loadAdsForTemplate } from "@/lib/ads.server";


export const Route = createFileRoute("/api/public/snapshot/$tenantKey/$roomId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, roomId } = params;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select(
            "id, name, past_grace_minutes, template, logo_url, logo_height, accent_color, ad_seconds",
          )
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const { data: room } = await supabaseAdmin
          .from("rooms")
          .select("id, name, color_scheme_id, template")
          .eq("id", roomId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (!room) return new Response("Not found", { status: 404 });

        const { data: entries } = await supabaseAdmin
          .from("entries")
          .select("id, time, end_time, title, description, tags, color_scheme_id")
          .eq("tenant_id", tenant.id);

        const { data: schemes } = await supabaseAdmin
          .from("color_schemes")
          .select("id, color")
          .eq("tenant_id", tenant.id);
        const colorById = new Map((schemes ?? []).map((s) => [s.id, s.color]));

        const effectiveTemplate = room.template || tenant.template;
        const { ads, adSeconds } = await loadAdsForTemplate({
          tenantId: tenant.id,
          tenantKey,
          template: effectiveTemplate,
          fallbackSeconds: tenant.ad_seconds,
        });



        const now = Date.now();
        const cutoff = now - tenant.past_grace_minutes * 60 * 1000;
        const visible = (entries ?? [])
          .filter((e) =>
            e.end_time
              ? new Date(e.end_time).getTime() >= now
              : new Date(e.time).getTime() >= cutoff,
          )
          .filter((e) => e.tags.length === 0 || e.tags.includes(room.name))
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
          .map((e) => ({
            id: e.id,
            time: e.time,
            end_time: e.end_time,
            title: e.title,
            description: e.description,
            tags: e.tags,
            color: e.color_scheme_id ? (colorById.get(e.color_scheme_id) ?? null) : null,
          }));

        return new Response(
          JSON.stringify({
            tenant: {
              name: tenant.name,
              past_grace_minutes: tenant.past_grace_minutes,
              template: tenant.template,
              logo_url: tenant.logo_url,
              logo_height: tenant.logo_height,
              accent_color: tenant.accent_color,
              ad_seconds: adSeconds,
            },
            room: {
              id: room.id,
              name: room.name,
              color: room.color_scheme_id ? (colorById.get(room.color_scheme_id) ?? null) : null,
              template: effectiveTemplate,
            },
            entries: visible,
            ads,


          }),
          { headers: { "content-type": "application/json", "cache-control": "no-store" } },
        );
      },
    },
  },
});
