-- Rename tables and columns
ALTER TABLE public.ad_sets RENAME TO slide_sets;
ALTER TABLE public.ads RENAME TO slides;

ALTER TABLE public.slide_sets RENAME COLUMN ad_seconds TO slide_seconds;
ALTER TABLE public.slides RENAME COLUMN ad_set_id TO slide_set_id;
ALTER TABLE public.tenants RENAME COLUMN ad_seconds TO slide_seconds;

-- Add per-slide duration override and per-set overlay toggles
ALTER TABLE public.slides ADD COLUMN duration_seconds integer;
ALTER TABLE public.slides ADD CONSTRAINT slides_duration_seconds_range CHECK (duration_seconds IS NULL OR (duration_seconds >= 1 AND duration_seconds <= 600));

ALTER TABLE public.slide_sets ADD COLUMN show_room_name boolean NOT NULL DEFAULT true;
ALTER TABLE public.slide_sets ADD COLUMN show_clock boolean NOT NULL DEFAULT true;
ALTER TABLE public.slide_sets ADD COLUMN show_logo boolean NOT NULL DEFAULT true;

-- Ensure service-role grants remain valid on the renamed tables
GRANT ALL ON public.slide_sets TO service_role;
GRANT ALL ON public.slides TO service_role;

-- Migrate display template references from ads:* to slides:*
UPDATE public.tenants SET template = 'slides' WHERE template = 'ads';
UPDATE public.tenants SET template = 'slides:' || substring(template from 5) WHERE template LIKE 'ads:%';
UPDATE public.rooms SET template = 'slides' WHERE template = 'ads';
UPDATE public.rooms SET template = 'slides:' || substring(template from 5) WHERE template LIKE 'ads:%';
