# Event-driven webhook dispatch instead of minutely polling

Today one background job runs **every minute**, all day, and scans every tenant even when nothing is due. That is where the compute time goes. Verified current state: a single active job `webhooks-dispatch-minutely` with schedule `* * * * *` calls `/api/public/webhooks-dispatch`, which loops over all tenants, entries and team-time slots on each tick.

## Goal

One central trigger for all tenants that fires **only at the exact minute the next notification is due**, and re-arms itself whenever times or teams change.

## How it will work

1. A database routine computes the next due moment across all tenants:
   - regular entries: `notify = true`, `kind = 'entry'`, `notified_at is null`, `time > now()`
   - team-time entries (`kind = 'practice'`): each team's own slot = entry time + (position x team-time minutes), skipping teams already announced
   - only tenants that actually have at least one enabled webhook
2. A rescheduler takes that moment (truncated to the minute, UTC) and rewrites a single scheduled job named `webhooks-dispatch-next` so it fires exactly at that minute. If nothing is upcoming, the job is removed entirely — zero compute until data changes.
3. The rescheduler runs automatically after any relevant change:
   - entries created / edited / deleted (time, end time, notify flag, kind)
   - teams created / deleted / reordered
   - tenant team-time duration or grace window changed
   - webhooks added / removed / enabled / disabled
4. The dispatch endpoint keeps its current posting logic unchanged, and at the end of every run re-arms the next trigger (so a run that handles one entry immediately schedules the following one).
5. Missed-run safety: the dispatch endpoint keeps the existing grace window, so if the platform is briefly unavailable at the exact minute, the entry is still posted on the next trigger. A cheap safety job runs every 30 minutes that only recomputes and re-arms the trigger (no HTTP call, no tenant scan) to heal any drift.
6. The old minutely job is removed.

## Technical notes

- New SQL migration adding `public.next_webhook_dispatch_at()` and `public.reschedule_webhook_dispatch()` (both `security definer`, `search_path = public`), plus `AFTER INSERT/UPDATE/DELETE` statement-level triggers on `entries`, `teams`, `webhooks` and `tenants` calling the rescheduler.
- The rescheduler uses `cron.unschedule` + `cron.schedule` with a pinned expression `min hour day month *` derived from the next due timestamp in UTC, and stores the target URL/anon key in the job command exactly as the current job does.
- Team slot math mirrors `src/lib/practice.ts` / the dispatch route: teams ordered by `sort_order`, then `created_at`; slot length `tenants.practice_minutes` (min 1); teams listed in `entries.notified_teams` are excluded.
- `src/routes/api/public/webhooks-dispatch.ts`: after the tenant loop, call `supabase.rpc('reschedule_webhook_dispatch')`. Grant execute on that function to `service_role` only.
- The self-referencing job command (URL + anon key) contains project-specific values, so it is created with a data statement, not in a migration.
