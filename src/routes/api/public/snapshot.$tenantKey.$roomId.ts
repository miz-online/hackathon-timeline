import { createFileRoute } from "@tanstack/react-router";

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
          .select("id, time, title, description, tags, color_scheme_id")
          .eq("tenant_id", tenant.id);

        const { data: schemes } = await supabaseAdmin
          .from("color_schemes")
          .select("id, color")
          .eq("tenant_id", tenant.id);
        const colorById = new Map((schemes ?? []).map((s) => [s.id, s.color]));

        const { data: ads } = await supabaseAdmin
          .from("ads")
          .select("id, name, content_type, path")
          .eq("tenant_id", tenant.id)
          .order("sort_order", { ascending: true });

        // Signed storage URLs so displays don't load images through this
        // worker origin (a long-lived SSE connection can stall those).
        const signed = new Map<string, string>();
        if (ads?.length) {
          const { data: urls } = await supabaseAdmin.storage
            .from("tenant-ads")
            .createSignedUrls(
              ads.map((a) => a.path),
              60 * 60 * 12,
            );
          (urls ?? []).forEach((u, i) => {
            if (u.signedUrl && ads[i]) signed.set(ads[i].id, u.signedUrl);
          });
        }


        const cutoff = Date.now() - tenant.past_grace_minutes * 60 * 1000;
        const visible = (entries ?? [])
          .filter((e) => new Date(e.time).getTime() >= cutoff)
          .filter((e) => e.tags.length === 0 || e.tags.includes(room.name))
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
          .map((e) => ({
            id: e.id,
            time: e.time,
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
              ad_seconds: tenant.ad_seconds,
            },
            room: {
              id: room.id,
              name: room.name,
              color: room.color_scheme_id ? (colorById.get(room.color_scheme_id) ?? null) : null,
              template: room.template || tenant.template,
            },
            entries: visible,
            ads: (ads ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              url: `/api/public/ad/${tenantKey}/${a.id}`,
              content_type: a.content_type,
            })),
          }),
          { headers: { "content-type": "application/json", "cache-control": "no-store" } },
        );
      },
    },
  },
});
