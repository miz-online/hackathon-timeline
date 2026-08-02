import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stream/$tenantKey/$roomId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, roomId } = params;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant, error: tErr } = await supabaseAdmin
          .from("tenants")
          .select("id, name")
          .eq("key", tenantKey)
          .maybeSingle();
        if (tErr || !tenant) return new Response("Not found", { status: 404 });

        const { data: room, error: rErr } = await supabaseAdmin
          .from("rooms")
          .select("id, name")
          .eq("id", roomId)
          .eq("tenant_id", tenant.id)
          .maybeSingle();
        if (rErr || !room) return new Response("Not found", { status: 404 });

        const tenantId = tenant.id;
        const roomDbId = room.id;
        const encoder = new TextEncoder();

        const buildSnapshot = async () => {
          const { data: tNow } = await supabaseAdmin
            .from("tenants")
            .select(
              "name, past_grace_minutes, template, logo_url, logo_height, accent_color, ad_seconds",
            )
            .eq("id", tenantId)
            .maybeSingle();
          const { data: rNow } = await supabaseAdmin
            .from("rooms")
            .select("id, name, color_scheme_id, template")
            .eq("id", roomDbId)
            .maybeSingle();
          if (!tNow || !rNow) return null;
          const { data: entries } = await supabaseAdmin
            .from("entries")
            .select("id, time, title, description, tags, color_scheme_id")
            .eq("tenant_id", tenantId);
          const { data: schemes } = await supabaseAdmin
            .from("color_schemes")
            .select("id, color")
            .eq("tenant_id", tenantId);
          const { data: ads } = await supabaseAdmin
            .from("ads")
            .select("id, name, content_type, path")
            .eq("tenant_id", tenantId)
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

          const colorById = new Map((schemes ?? []).map((s) => [s.id, s.color]));
          const cutoff = Date.now() - tNow.past_grace_minutes * 60 * 1000;
          const visible = (entries ?? [])
            .filter((e) => new Date(e.time).getTime() >= cutoff)
            .filter((e) => e.tags.length === 0 || e.tags.includes(rNow.name))
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
            .map((e) => ({
              id: e.id,
              time: e.time,
              title: e.title,
              description: e.description,
              tags: e.tags,
              color: e.color_scheme_id ? (colorById.get(e.color_scheme_id) ?? null) : null,
            }));
          return {
            tenant: {
              name: tNow.name,
              past_grace_minutes: tNow.past_grace_minutes,
              template: tNow.template,
              logo_url: tNow.logo_url,
              logo_height: tNow.logo_height,
              accent_color: tNow.accent_color,
              ad_seconds: tNow.ad_seconds,
            },
            room: {
              id: rNow.id,
              name: rNow.name,
              color: rNow.color_scheme_id ? (colorById.get(rNow.color_scheme_id) ?? null) : null,
              template: rNow.template || tNow.template,
            },
            entries: visible,
            ads: (ads ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              url: signed.get(a.id) ?? `/api/public/ad/${tenantKey}/${a.id}`,
              content_type: a.content_type,
            })),

          };
        };

        let cleanup: () => void = () => {};
        const stream = new ReadableStream({
          async start(controller) {
            let closed = false;
            const send = (event: string, payload: unknown) => {
              if (closed) return;
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
                );
              } catch {
                /* ignore */
              }
            };
            const sendComment = (msg: string) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(`: ${msg}\n\n`));
              } catch {
                /* ignore */
              }
            };

            const snap = await buildSnapshot();
            if (snap) send("snapshot", snap);

            const pushUpdate = async () => {
              const s = await buildSnapshot();
              if (s) send("update", s);
            };

            const channel = supabaseAdmin
              .channel(`room-${roomDbId}-${Math.random().toString(36).slice(2)}`)
              .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "entries", filter: `tenant_id=eq.${tenantId}` },
                () => void pushUpdate(),
              )
              .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "rooms", filter: `tenant_id=eq.${tenantId}` },
                () => void pushUpdate(),
              )
              .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "tenants", filter: `id=eq.${tenantId}` },
                () => void pushUpdate(),
              )
              .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "color_schemes", filter: `tenant_id=eq.${tenantId}` },
                () => void pushUpdate(),
              )
              .subscribe();

            const keepalive = setInterval(() => sendComment("ka"), 25_000);

            cleanup = () => {
              if (closed) return;
              closed = true;
              clearInterval(keepalive);
              try {
                void supabaseAdmin.removeChannel(channel);
              } catch {
                /* ignore */
              }
              try {
                controller.close();
              } catch {
                /* ignore */
              }
            };
          },
          cancel() {
            cleanup();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
