import { createFileRoute } from "@tanstack/react-router";
import { loadAdsForTemplate } from "@/lib/ads.server";
import { expandPracticeEntries, type PracticeTeam } from "@/lib/practice";
import { withRoomRegisterTokens } from "@/lib/register-url";


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

        const isOverview = roomId === "overview";
        const room = isOverview
          ? { id: "overview", name: "" }
          : (
              await supabaseAdmin
                .from("rooms")
                .select("id, name")
                .eq("id", roomId)
                .eq("tenant_id", tenant.id)
                .maybeSingle()
            ).data;
        if (!room) return new Response("Not found", { status: 404 });

        const tenantId = tenant.id;
        const roomDbId = room.id;
        const encoder = new TextEncoder();

        const buildSnapshot = async () => {
          const { data: tNow } = await supabaseAdmin
            .from("tenants")
            .select(
              "name, past_grace_minutes, template, logo_url, logo_height, accent_color, ad_seconds, focus_mode, focus_count, focus_minutes, focus_dim_opacity, practice_minutes, practice_room_scope",
            )
            .eq("id", tenantId)
            .maybeSingle();
          const rNow = isOverview
            ? { id: "overview", name: "", color_scheme_id: null as string | null, template: null as string | null }
            : (
                await supabaseAdmin
                  .from("rooms")
                  .select("id, name, color_scheme_id, template")
                  .eq("id", roomDbId)
                  .maybeSingle()
              ).data;
          if (!tNow || !rNow) return null;
          const { data: entries } = await supabaseAdmin
            .from("entries")
            .select(
              "id, kind, time, end_time, title, description, tags, color_scheme_id, background_path, background_align, background_height, background_opacity, background_margin, background_tint, register_token",
            )
            .eq("tenant_id", tenantId);

          const { data: schemes } = await supabaseAdmin
            .from("color_schemes")
            .select("id, color")
            .eq("tenant_id", tenantId);
          const effectiveTemplate = rNow.template || tNow.template;
          const { ads, adSeconds } = await loadAdsForTemplate({
            tenantId,
            tenantKey,
            template: effectiveTemplate,
            fallbackSeconds: tNow.ad_seconds,
          });

          const { data: teamRows } = await supabaseAdmin
            .from("teams")
            .select("id, name, room_id, sort_order, created_at")
            .eq("tenant_id", tenantId)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });
          const { data: roomRows } = await supabaseAdmin
            .from("rooms")
            .select("id, color_scheme_id")
            .eq("tenant_id", tenantId);
          const colorById = new Map((schemes ?? []).map((s) => [s.id, s.color]));
          const roomColorById = new Map(
            (roomRows ?? []).map((r) => [
              r.id,
              r.color_scheme_id ? (colorById.get(r.color_scheme_id) ?? null) : null,
            ]),
          );
          const teams: PracticeTeam[] = (teamRows ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            room_id: t.room_id,
            color: t.room_id ? (roomColorById.get(t.room_id) ?? null) : null,
          }));
          const now = Date.now();
          const cutoff = now - tNow.past_grace_minutes * 60 * 1000;
          const mapped = (entries ?? []).map((e) => ({
            kind: e.kind,
              id: e.id,
              time: e.time,
              end_time: e.end_time,
              title: e.title,
              description: e.description,
              tags: e.tags,
              color: e.color_scheme_id ? (colorById.get(e.color_scheme_id) ?? null) : null,
              background_url: e.background_path
                ? `/api/public/entry-bg/${encodeURIComponent(tenantKey)}/${e.id}?v=${encodeURIComponent(e.background_path.split("/").pop() ?? "1")}`
                : null,
              background_align: e.background_align ?? "right-top",
              background_height: e.background_height ?? 80,
              background_opacity: e.background_opacity ?? 100,
              background_margin: e.background_margin ?? 0,
            background_tint: e.background_tint ?? null,
            register_token: (e as { register_token?: string | null }).register_token ?? null,
            }));
          const expanded = expandPracticeEntries(mapped, {
            teams,
            practiceMinutes: tNow.practice_minutes ?? 10,
            scope: tNow.practice_room_scope ?? "all",
            roomId: rNow.id,
            isOverview,
          });
          const withTokens = await withRoomRegisterTokens(expanded, rNow.id, isOverview);
          const visible = withTokens
            .filter((e) =>
              e.end_time
                ? new Date(e.end_time).getTime() >= now
                : new Date(e.time).getTime() >= cutoff,
            )
            .filter((e) => isOverview || e.tags.length === 0 || e.tags.includes(rNow.name))
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

          return {
            tenant: {
              name: tNow.name,
              past_grace_minutes: tNow.past_grace_minutes,
              template: tNow.template,
              logo_url: tNow.logo_url,
              logo_height: tNow.logo_height,
              accent_color: tNow.accent_color,
              ad_seconds: adSeconds,
              focus_mode: tNow.focus_mode ?? "count",
              focus_count: tNow.focus_count ?? 3,
              focus_minutes: tNow.focus_minutes ?? 30,
              focus_dim_opacity: tNow.focus_dim_opacity ?? 35,
              practice_minutes: tNow.practice_minutes ?? 10,
              practice_room_scope: tNow.practice_room_scope ?? "all",
            },
            room: {
              id: rNow.id,
              name: rNow.name,
              color: rNow.color_scheme_id ? (colorById.get(rNow.color_scheme_id) ?? null) : null,
              template: effectiveTemplate,
              is_overview: isOverview,
            },
            entries: visible,
            ads,


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
              .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "teams", filter: `tenant_id=eq.${tenantId}` },
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
