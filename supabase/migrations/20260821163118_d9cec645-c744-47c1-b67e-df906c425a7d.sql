ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS notified_teams text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.reset_entry_notified_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.time IS DISTINCT FROM OLD.time THEN
    NEW.notified_at = NULL;
    NEW.notified_teams = '{}'::text[];
  END IF;
  RETURN NEW;
END;
$function$;