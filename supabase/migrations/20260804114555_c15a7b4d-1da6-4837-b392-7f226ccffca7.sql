ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS ref_id text;
ALTER TABLE public.color_schemes ADD COLUMN IF NOT EXISTS ref_id text;
CREATE UNIQUE INDEX IF NOT EXISTS rooms_tenant_ref_id_key ON public.rooms (tenant_id, ref_id) WHERE ref_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS color_schemes_tenant_ref_id_key ON public.color_schemes (tenant_id, ref_id) WHERE ref_id IS NOT NULL;