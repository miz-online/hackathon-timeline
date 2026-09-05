import { getBackendAdmin } from "@/lib/backend/admin.server";
import { createFileRoute } from "@tanstack/react-router";
import { loadAdsForTemplate } from "@/lib/ads.server";
import { withOptionalColumns } from "@/lib/optional-columns";
import { expandPracticeEntries, type PracticeTeam } from "@/lib/practice";
import { withRoomRegisterTokens, type DisplayEntryRow } from "@/lib/register-url";


export const Route = createFileRoute("/api/public/snapshot/$tenantKey/$roomId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { tenantKey, roomId } = params;
        const supabaseAdmin = await getBackendAdmin();

        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select(
            "id, name, past_grace_minutes, template, logo_url, logo_height, accent_color, ad_seconds, focus_mode, focus_count, focus_minutes, focus_dim_opacity, practice_minutes, practice_room_scope",
          )
          .eq("key", tenantKey)
          .maybeSingle();
        if (!tenant) return new Response("Not found", { status: 404 });

        const isOverview = roomId === "overview";
        const room = isOverview
          ? { id: "overview", name: "", color_scheme_id: null as string | null, template: null as string | null }
          : (
              await supabaseAdmin
                .from("rooms")
                .select("id, name, color_scheme_id, template")
                .eq("id", roomId)
                .eq("tenant_id", tenant.id)
                .maybeSingle()
            ).data;
        if (!room) return new Response("Not found", { status: 404 });

        // register_token only exists once the pending migration is applied.
        const entryCols =
          "id, kind, time, end_time, title, description, tags, color_scheme_id, background_path, background_align, background_height, background_opacity, background_margin, background_tint";
        const readEntries = (cols: string) =>
          supabaseAdmin.from("entries").select(cols).eq("tenant_id", tenant.id) as unknown as Promise<{
            data: unknown;
            error: unknown;
          }>;
        const { data: entries } = await withOptionalColumns(
          () => readEntries(`${entryCols}, register_token`),
          () => readEntries(entryCols),
        );


        const { data: schemes } = await supabaseAdmin
          .from("color_schemes")
          .select("id, color")
          .eq("tenant_id", tenant.id);
          const { data: teamRows } = await supabaseAdmin
            .from("teams")
            .select("id, name, room_id, sort_order, created_at")
            .eq("tenant_id", tenant.id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });
          const { data: roomRows } = await supabaseAdmin
            .from("rooms")
            .select("id, color_scheme_id")
            .eq("tenant_id", tenant.id);
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

        const effectiveTemplate = room.template || tenant.template;
        const { ads, adSeconds } = await loadAdsForTemplate({
          tenantId: tenant.id,
          tenantKey,
          template: effectiveTemplate,
          fallbackSeconds: tenant.ad_seconds,
        });



        const now = Date.now();
        const cutoff = now - tenant.past_grace_minutes * 60 * 1000;
        const mapped = ((entries ?? []) as unknown as DisplayEntryRow[]).map((e) => ({
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
            practiceMinutes: tenant.practice_minutes ?? 10,
            scope: tenant.practice_room_scope ?? "all",
            roomId: room.id,
            isOverview,
          });
          const withTokens = await withRoomRegisterTokens(expanded, room.id, isOverview);
          const visible = withTokens
          .filter((e) =>
            e.end_time
              ? new Date(e.end_time).getTime() >= now
              : new Date(e.time).getTime() >= cutoff,
          )
          .filter((e) => isOverview || e.tags.length === 0 || e.tags.includes(room.name))
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());


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
              focus_mode: tenant.focus_mode ?? "count",
              focus_count: tenant.focus_count ?? 3,
              focus_minutes: tenant.focus_minutes ?? 30,
              focus_dim_opacity: tenant.focus_dim_opacity ?? 35,
              practice_minutes: tenant.practice_minutes ?? 10,
              practice_room_scope: tenant.practice_room_scope ?? "all",
            },
            room: {
              id: room.id,
              name: room.name,
              color: room.color_scheme_id ? (colorById.get(room.color_scheme_id) ?? null) : null,
              template: effectiveTemplate,
              is_overview: isOverview,
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
