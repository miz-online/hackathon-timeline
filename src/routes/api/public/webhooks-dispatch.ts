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
          .select("id, name, accent_color, past_grace_minutes");

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
              "id, time, end_time, title, description, color_scheme_id, notify, notified_at, background_path, background_content_type",
            )
            .eq("tenant_id", tenant.id)
            .eq("notify", true)
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
                image = {
                  filename: entry.background_path.split("/").pop() || "image.png",
                  contentType: entry.background_content_type || file.type || "image/png",
                  bytes: new Uint8Array(await file.arrayBuffer()),
                };
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
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
