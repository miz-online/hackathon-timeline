import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendWebhook, type WebhookType } from "@/lib/webhooks";



export const Route = createFileRoute("/api/public/webhooks-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("apikey");
        const allowed = [
          process.env["SUPABASE_ANON_KEY"],
          process.env["SUPABASE_PUBLISHABLE_KEY"],
          process.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
        ].filter((v): v is string => !!v);
        if (!provided || !allowed.includes(provided)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabase = createClient(
          process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!,
          process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );

        const now = new Date();
        const results: {
          tenant: string;
          webhook: string;
          entry: string;
          ok: boolean;
          error?: string;
        }[] = [];

        const { data: tenants } = await supabase
          .from("tenants")
          .select("id, name, accent_color, past_grace_minutes, practice_minutes");

        for (const tenant of tenants ?? []) {
          const { data: webhooks } = await supabase
            .from("webhooks")
            .select("id, name, url, type")
            .eq("tenant_id", tenant.id)
            .eq("enabled", true);

          if (!webhooks?.length) continue;

          // Post entries that became due within the tenant's "now" grace window
          // and are not yet marked as sent. This avoids missing a post due to a
          // brief deploy/cold-start delay while still ignoring very old entries.
          const windowMinutes = tenant.past_grace_minutes ?? 5;
          const windowStart = new Date(now.getTime() - windowMinutes * 60_000);

          // Entries becoming due within the checked minute window
          const { data: entries } = await supabase
            .from("entries")
            .select(
              "id, time, end_time, title, description, color_scheme_id, notify, notified_at, background_path, background_content_type, background_tint",
            )
            .eq("tenant_id", tenant.id)
            .eq("notify", true)
            .eq("kind", "entry")
            .is("notified_at", null)
            .gt("time", windowStart.toISOString())
            .lte("time", now.toISOString());

          for (const entry of entries ?? []) {
            const entryTime = new Date(entry.time);

            const { data: scheme } = entry.color_scheme_id
              ? await supabase
                  .from("color_schemes")
                  .select("color")
                  .eq("id", entry.color_scheme_id)
                  .maybeSingle()
              : { data: null };

            const color = scheme?.color ?? tenant.accent_color;

            // Attach the entry's background image (if any) at the end of the message
            let image: { filename: string; contentType: string; bytes: Uint8Array } | null = null;
            if (entry.background_path) {
              const { data: file } = await supabase.storage
                .from("tenant-entry-backgrounds")
                .download(entry.background_path);
              if (file) {
                let bytes = new Uint8Array(await file.arrayBuffer());
                let contentType = entry.background_content_type || file.type || "image/png";
                let filename = entry.background_path.split("/").pop() || "image.png";
                // Tinted images are rendered as masks on the display; for chat
                // messages we reshade them to neutral grey so they work on both
                // light and dark themes.
                if (entry.background_tint && contentType.includes("png")) {
                  const { greyscalePng } = await import("@/lib/image-grey.server");
                  const grey = greyscalePng(bytes);
                  if (grey) {
                    bytes = new Uint8Array(grey.buffer.slice(0) as ArrayBuffer);
                    contentType = "image/png";
                    filename = filename.replace(/(\.[A-Za-z0-9]+)?$/, ".png");
                  }
                }
                image = { filename, contentType, bytes };
              }
            }


            let anyOk = false;
            for (const webhook of webhooks) {
              const result = await sendWebhook(webhook.url, webhook.type as WebhookType, {
                title: entry.title,
                description: entry.description,
                color,
                time: entryTime,
                endTime: entry.end_time ? new Date(entry.end_time) : null,
                image,
              });

              if (result.ok) anyOk = true;

              results.push({
                tenant: tenant.name,
                webhook: webhook.name,
                entry: entry.title,
                ok: result.ok,
                error: result.ok ? undefined : result.error,
              });
            }

            if (anyOk) {
              await supabase
                .from("entries")
                .update({ notified_at: new Date().toISOString() })
                .eq("id", entry.id);
            }
          }

          // Team time ("practice") entries are posted per team, at the time the
          // team's own slot becomes due — mirroring how the room display shows
          // one row per team.
          const { data: practices } = await supabase
            .from("entries")
            .select(
              "id, time, title, notify, notified_teams, background_path, background_content_type, background_tint",
            )
            .eq("tenant_id", tenant.id)
            .eq("notify", true)
            .eq("kind", "practice")
            .gt("time", new Date(now.getTime() - 24 * 3600_000).toISOString());

          if (practices?.length) {
            const minutes = Math.max(1, tenant.practice_minutes ?? 10);
            const { data: teams } = await supabase
              .from("teams")
              .select("id, name, room_id")
              .eq("tenant_id", tenant.id)
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true });
            const { data: teamRooms } = await supabase
              .from("rooms")
              .select("id, color_scheme_id")
              .eq("tenant_id", tenant.id);
            const { data: schemes } = await supabase
              .from("color_schemes")
              .select("id, color")
              .eq("tenant_id", tenant.id);
            const colorOfRoom = (roomId: string | null) => {
              const room = (teamRooms ?? []).find((r) => r.id === roomId);
              const scheme = room?.color_scheme_id
                ? (schemes ?? []).find((s) => s.id === room.color_scheme_id)
                : undefined;
              return scheme?.color ?? tenant.accent_color;
            };

            for (const practice of practices) {
              const start = new Date(practice.time).getTime();
              const done = new Set<string>(practice.notified_teams ?? []);
              const due = (teams ?? [])
                .map((team, idx) => ({ team, slot: new Date(start + idx * minutes * 60_000) }))
                .filter(
                  ({ team, slot }) =>
                    !done.has(team.id) && slot > windowStart && slot <= now,
                );
              if (!due.length) continue;

              let image: { filename: string; contentType: string; bytes: Uint8Array } | null = null;
              if (practice.background_path) {
                const { data: file } = await supabase.storage
                  .from("tenant-entry-backgrounds")
                  .download(practice.background_path);
                if (file) {
                  let bytes = new Uint8Array(await file.arrayBuffer());
                  let contentType = practice.background_content_type || file.type || "image/png";
                  let filename = practice.background_path.split("/").pop() || "image.png";
                  if (practice.background_tint && contentType.includes("png")) {
                    const { greyscalePng } = await import("@/lib/image-grey.server");
                    const grey = greyscalePng(bytes);
                    if (grey) {
                      bytes = new Uint8Array(grey.buffer.slice(0) as ArrayBuffer);
                      contentType = "image/png";
                      filename = filename.replace(/(\.[A-Za-z0-9]+)?$/, ".png");
                    }
                  }
                  image = { filename, contentType, bytes };
                }
              }

              for (const { team, slot } of due) {
                let anyOk = false;
                for (const webhook of webhooks) {
                  const result = await sendWebhook(webhook.url, webhook.type as WebhookType, {
                    title: team.name,
                    description: practice.title,
                    color: colorOfRoom(team.room_id),
                    time: slot,
                    endTime: new Date(slot.getTime() + minutes * 60_000),
                    image,
                  });
                  if (result.ok) anyOk = true;
                  results.push({
                    tenant: tenant.name,
                    webhook: webhook.name,
                    entry: `${practice.title} — ${team.name}`,
                    ok: result.ok,
                    error: result.ok ? undefined : result.error,
                  });
                }
                if (anyOk) done.add(team.id);
              }

              await supabase
                .from("entries")
                .update({ notified_teams: [...done] })
                .eq("id", practice.id);
            }
          }
        }

        // Re-arm the single central trigger for the next due notification.
        const { data: nextRun } = await supabase.rpc("reschedule_webhook_dispatch");

        return Response.json({ ok: true, processed: results.length, nextRun, results });
      },
    },
  },
});
