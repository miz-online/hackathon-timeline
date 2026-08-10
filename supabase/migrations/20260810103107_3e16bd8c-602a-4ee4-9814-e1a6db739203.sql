ALTER TABLE public.tenants ADD COLUMN pin_hash text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants service only ALL" ON public.tenants FOR ALL TO service_role USING (true) WITH CHECK (true);