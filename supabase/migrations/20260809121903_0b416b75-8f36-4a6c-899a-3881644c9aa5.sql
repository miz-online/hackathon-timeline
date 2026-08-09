ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS notified_at timestamp with time zone;

-- backfill from existing deliveries
UPDATE public.entries e
SET notified_at = d.sent_at
FROM (
  SELECT entry_id, entry_time, max(sent_at) AS sent_at
  FROM public.webhook_deliveries
  GROUP BY entry_id, entry_time
) d
WHERE d.entry_id = e.id AND d.entry_time = e.time;

CREATE OR REPLACE FUNCTION public.reset_entry_notified_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.time IS DISTINCT FROM OLD.time THEN
    NEW.notified_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entries_reset_notified_at ON public.entries;
CREATE TRIGGER entries_reset_notified_at
BEFORE UPDATE ON public.entries
FOR EACH ROW EXECUTE FUNCTION public.reset_entry_notified_at();

DROP TABLE IF EXISTS public.webhook_deliveries;