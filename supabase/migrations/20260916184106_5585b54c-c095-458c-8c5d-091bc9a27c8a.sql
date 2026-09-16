CREATE TABLE public.team_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ref_id text,
  name text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.team_files TO service_role;
ALTER TABLE public.team_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team_files service only" ON public.team_files FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX team_files_team_idx ON public.team_files (team_id, sort_order);
CREATE TRIGGER team_files_touch_updated_at BEFORE UPDATE ON public.team_files FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tenant_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ref_id text,
  name text NOT NULL,
  storage_key text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.tenant_files TO service_role;
ALTER TABLE public.tenant_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_files service only" ON public.tenant_files FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX tenant_files_tenant_idx ON public.tenant_files (tenant_id, sort_order);
CREATE TRIGGER tenant_files_touch_updated_at BEFORE UPDATE ON public.tenant_files FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS max_upload_mb integer NOT NULL DEFAULT 10;