import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendWebhook, type WebhookType } from "@/lib/webhooks";

const CHECK_WINDOW_MS = 60_000; // 1 minute window

export const Route = createFileRoute("/api/public/webhooks-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("apikey");
        if (auth !== process.env["VITE_SUPABASE_ANON_KEY"]) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabase = createClient(
          process.env["VITE_SUPABASE_URL"]!,
          process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );

        const now = new Date();
        const windowStart = new Date(now.getTime() - CHECK_WINDOW_MS);
        const windowEnd = new Date(now.getTime() + CHECK_WINDOW_MS / 2);

        const { data: tenants } = await supabase.from("tenants").select("id, name, accent_color");

        const results: {
          tenant: string;
          webhook: string;
          entry: string;
          ok: boolean;
          error?: string;
        }[] = [];

        for (const tenant of tenants ?? []) {
          const { data: webhooks } = await supabase
            .from("webhooks")
            .select("id, name, url, type")
            .eq("tenant_id", tenant.id)
            .eq("enabled", true);

          if (!webhooks?.length) continue;

          const { data: entries } = await supabase
            .from("entries")
            .select("id, time, title, description, color_scheme_id, notify")
            .eq("tenant_id", tenant.id)
            .eq("notify", true)
            .gte("time", windowStart.toISOString())
            .lte("time", windowEnd.toISOString());

          for (const entry of entries ?? []) {
            // Skip if already delivered in this minute window
            const { data: existing } = await supabase
              .from("webhook_deliveries")
              .select("id")
              .eq("entry_id", entry.id)
              .gte("delivered_at", windowStart.toISOString())
              .limit(1);
            if (existing?.length) continue;

            const entryTime = new Date(entry.time);
            // Only post entries that are exactly due in the current checked minute
            const diffMs = now.getTime() - entryTime.getTime();
            if (diffMs < 0 || diffMs > CHECK_WINDOW_MS) continue;

            const { data: scheme } = entry.color_scheme_id
              ? await supabase
                  .from("color_schemes")
                  .select("color")
                  .eq("id", entry.color_scheme_id)
                  .maybeSingle()
              : { data: null };

            const color = scheme?.color ?? tenant.accent_color;

            for (const webhook of webhooks) {
              const result = await sendWebhook(webhook.url, webhook.type as WebhookType, {
                title: entry.title,
                description: entry.description,
                color,
                time: entryTime,
              });

              await supabase.from("webhook_deliveries").insert({
                webhook_id: webhook.id,
                entry_id: entry.id,
                success: result.ok,
                error: result.error ?? null,
              });

              results.push({
                tenant: tenant.name,
                webhook: webhook.name,
                entry: entry.title,
                ok: result.ok,
                error: result.error,
              });
            }
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
