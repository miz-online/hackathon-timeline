ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT '#C0322B';

CREATE TABLE IF NOT EXISTS public.color_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#C0322B',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.color_schemes TO service_role;
ALTER TABLE public.color_schemes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS color_scheme_id uuid REFERENCES public.color_schemes(id) ON DELETE SET NULL;

ALTER TABLE public.color_schemes REPLICA IDENTITY FULL;