ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS background_path text,
  ADD COLUMN IF NOT EXISTS background_content_type text,
  ADD COLUMN IF NOT EXISTS background_align text NOT NULL DEFAULT 'right-top',
  ADD COLUMN IF NOT EXISTS background_height integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS background_opacity integer NOT NULL DEFAULT 100;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_background_align_check
  CHECK (background_align IN ('right-top','right-bottom','right-stretch','fill','time'));

ALTER TABLE public.entries
  ADD CONSTRAINT entries_background_height_check CHECK (background_height BETWEEN 8 AND 2000);

ALTER TABLE public.entries
  ADD CONSTRAINT entries_background_opacity_check CHECK (background_opacity BETWEEN 0 AND 100);