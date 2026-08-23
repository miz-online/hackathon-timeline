-- Config for the self-scheduling dispatch trigger (values filled in separately)
CREATE TABLE IF NOT EXISTS public.dispatch_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  endpoint_url text NOT NULL,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.dispatch_config TO service_role;
ALTER TABLE public.dispatch_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatch_config service only" ON public.dispatch_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Next moment (across all tenants) at which a webhook notification is due
CREATE OR REPLACE FUNCTION public.next_webhook_dispatch_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_tenants AS (
    SELECT t.id, t.past_grace_minutes, GREATEST(1, COALESCE(t.practice_minutes, 10)) AS practice_minutes
    FROM public.tenants t
    WHERE EXISTS (
      SELECT 1 FROM public.webhooks w WHERE w.tenant_id = t.id AND w.enabled
    )
  ),
  entry_due AS (
    SELECT min(e.time) AS due
    FROM public.entries e
    JOIN active_tenants t ON t.id = e.tenant_id
    WHERE e.notify
      AND e.kind = 'entry'
      AND e.notified_at IS NULL
      AND e.time > now() - make_interval(mins => COALESCE(t.past_grace_minutes, 5))
  ),
  team_slots AS (
    SELECT e.time + make_interval(mins => (row_number() OVER (PARTITION BY e.id ORDER BY tm.sort_order, tm.created_at) - 1)::int * t.practice_minutes) AS due
    FROM public.entries e
    JOIN active_tenants t ON t.id = e.tenant_id
    JOIN public.teams tm ON tm.tenant_id = e.tenant_id
    WHERE e.notify
      AND e.kind = 'practice'
      AND NOT (tm.id::text = ANY (COALESCE(e.notified_teams, '{}'::text[])))
  ),
  practice_due AS (
    SELECT min(s.due) AS due
    FROM team_slots s
    WHERE s.due > now() - interval '1 hour'
  )
  SELECT min(due) FROM (
    SELECT due FROM entry_due
    UNION ALL
    SELECT due FROM practice_due
  ) x
  WHERE due IS NOT NULL;
$$;

-- Rewrites the single central cron job so it fires exactly when the next
-- notification is due (or removes it when nothing is upcoming).
CREATE OR REPLACE FUNCTION public.reschedule_webhook_dispatch()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.dispatch_config;
  due timestamptz;
  target timestamptz;
  sched text;
  cmd text;
BEGIN
  SELECT * INTO cfg FROM public.dispatch_config LIMIT 1;
  IF cfg IS NULL THEN
    RETURN NULL;
  END IF;

  due := public.next_webhook_dispatch_at();

  PERFORM cron.unschedule('webhooks-dispatch-next')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhooks-dispatch-next');

  IF due IS NULL THEN
    RETURN NULL;
  END IF;

  -- clamp to the next full minute so a due-in-the-past entry fires immediately
  target := date_trunc('minute', GREATEST(due, now() + interval '20 seconds') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF target < now() THEN
    target := date_trunc('minute', now()) + interval '1 minute';
  END IF;

  sched := to_char(target AT TIME ZONE 'UTC', 'MI HH24 DD MM') || ' *';
  cmd := format(
    $c$select net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb) as request_id;$c$,
    cfg.endpoint_url,
    json_build_object('Content-Type', 'application/json', 'apikey', cfg.api_key)::text
  );

  PERFORM cron.schedule('webhooks-dispatch-next', sched, cmd);
  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_webhook_dispatch() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_webhook_dispatch_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_webhook_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_webhook_dispatch_at() TO service_role;

-- Re-arm the trigger whenever relevant data changes
CREATE OR REPLACE FUNCTION public.trg_reschedule_webhook_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reschedule_webhook_dispatch();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS entries_reschedule_dispatch ON public.entries;
CREATE TRIGGER entries_reschedule_dispatch
AFTER INSERT OR UPDATE OR DELETE ON public.entries
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_reschedule_webhook_dispatch();

DROP TRIGGER IF EXISTS teams_reschedule_dispatch ON public.teams;
CREATE TRIGGER teams_reschedule_dispatch
AFTER INSERT OR UPDATE OR DELETE ON public.teams
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_reschedule_webhook_dispatch();

DROP TRIGGER IF EXISTS webhooks_reschedule_dispatch ON public.webhooks;
CREATE TRIGGER webhooks_reschedule_dispatch
AFTER INSERT OR UPDATE OR DELETE ON public.webhooks
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_reschedule_webhook_dispatch();

DROP TRIGGER IF EXISTS tenants_reschedule_dispatch ON public.tenants;
CREATE TRIGGER tenants_reschedule_dispatch
AFTER INSERT OR UPDATE OR DELETE ON public.tenants
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_reschedule_webhook_dispatch();