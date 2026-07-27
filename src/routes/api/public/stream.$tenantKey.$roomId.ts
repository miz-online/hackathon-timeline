import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stream/$tenantKey/$roomId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, roomId } = params;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tenant, error: tErr } = await supabaseAdmin
          .from("tenants")
          .select("id, name, past_grace_minutes, template, logo_url")
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
            .select("name, past_grace_minutes, template, logo_url")
            .eq("id", tenantId)
            .maybeSingle();
          const { data: rNow } = await supabaseAdmin
            .from("rooms")
            .select("id, name")
            .eq("id", roomDbId)
            .maybeSingle();
          if (!tNow || !rNow) return null;
          const { data: entries } = await supabaseAdmin
            .from("entries")
            .select("id, time, title, description, tags")
            .eq("tenant_id", tenantId);
          const cutoff = Date.now() - tNow.past_grace_minutes * 60 * 1000;
          const visible = (entries ?? [])
            .filter((e) => new Date(e.time).getTime() >= cutoff)
            .filter((e) => e.tags.length === 0 || e.tags.includes(rNow.name))
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
          return {
            tenant: {
              name: tNow.name,
              past_grace_minutes: tNow.past_grace_minutes,
              template: tNow.template,
              logo_url: tNow.logo_url,
            },
            room: rNow,
            entries: visible,
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
