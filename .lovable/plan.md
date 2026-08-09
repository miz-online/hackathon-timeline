# Why nothing was posted

Checked the live system. The scheduling and the endpoint are both working:

- The minutely job runs every minute and gets HTTP 200 from the published site.
- Every response is `{"ok":true,"processed":0}` — so nothing was *eligible*.

Reason: the only entry that came due (09.08., 12:23) has "Post to webhooks when due" **switched off** in the database, so the dispatcher correctly skipped it. The older entries (06.08.) were already in the past before the webhook feature existed, and the dispatcher only posts entries that become due within the current minute.

The confusing part is the admin list: it showed that entry with the "pending" clock icon even though posting is disabled for it. That icon logic lost the "posting disabled" case in an earlier change.

## What to change

1. **Fix the status icon precedence** in the entries list:
   - posted → check icon ("Posted")
   - posting disabled → bell-off icon ("Not posted to webhooks")
   - in the past, not posted → history icon
   - otherwise (future, enabled) → clock icon ("Pending")

2. **Add a catch-up window to the dispatcher** so a single missed minute (deploy, cold start, brief outage) doesn't silently drop a post: instead of only the last 60 seconds, consider entries that became due within the tenant's `past_grace_minutes` window and are not yet marked as sent. Entries older than that stay unsent, as today.

3. **Verification after the change**: create a test entry a couple of minutes in the future with posting enabled, wait for the job, and confirm the Discord message arrives and the entry flips to "Posted".

## Technical notes

- `src/routes/tenant/$tenantKey/index.tsx` — icon block around the color dot; use `notify` in the precedence chain again.
- `src/routes/api/public/webhooks-dispatch.ts` — `CHECK_WINDOW_MS` 60_000 → 600_000; the `notified_at IS NULL` filter already prevents duplicates.
- No database or schema changes needed; the job, route auth and `notified_at` marker all work as intended.
