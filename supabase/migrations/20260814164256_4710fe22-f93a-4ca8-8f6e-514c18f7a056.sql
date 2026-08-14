ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS focus_mode text NOT NULL DEFAULT 'count',
  ADD COLUMN IF NOT EXISTS focus_count integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS focus_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS focus_dim_opacity integer NOT NULL DEFAULT 35;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_focus_mode_check CHECK (focus_mode IN ('count', 'minutes'));