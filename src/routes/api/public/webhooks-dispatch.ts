import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendWebhook, type WebhookType } from "@/lib/webhooks";

const CHECK_WINDOW_MS = 60_000; // 1 minute window

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
        const windowStart = new Date(now.getTime() - CHECK_WINDOW_MS);

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

          // Entries becoming due within the checked minute window
          const { data: entries } = await supabase
            .from("entries")
            .select("id, time, title, description, color_scheme_id, notify")
            .eq("tenant_id", tenant.id)
            .eq("notify", true)
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

            for (const webhook of webhooks) {
              // Deliver each entry once per webhook and entry time
              const { data: existing } = await supabase
                .from("webhook_deliveries")
                .select("id")
                .eq("webhook_id", webhook.id)
                .eq("entry_id", entry.id)
                .eq("entry_time", entryTime.toISOString())
                .limit(1);
              if (existing?.length) continue;

              const result = await sendWebhook(webhook.url, webhook.type as WebhookType, {
                title: entry.title,
                description: entry.description,
                color,
                time: entryTime,
              });

              if (result.ok) {
                await supabase.from("webhook_deliveries").insert({
                  webhook_id: webhook.id,
                  entry_id: entry.id,
                  entry_time: entryTime.toISOString(),
                });
              }

              results.push({
                tenant: tenant.name,
                webhook: webhook.name,
                entry: entry.title,
                ok: result.ok,
                error: result.ok ? undefined : result.error,
              });
            }
          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
