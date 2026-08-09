CREATE TABLE public.ad_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ref_id text,
  name text NOT NULL DEFAULT 'Ads',
  ad_seconds integer NOT NULL DEFAULT 10,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.ad_sets TO service_role;

ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_sets service only" ON public.ad_sets FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER ad_sets_touch_updated_at BEFORE UPDATE ON public.ad_sets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.ads ADD COLUMN ad_set_id uuid REFERENCES public.ad_sets(id) ON DELETE CASCADE;

INSERT INTO public.ad_sets (tenant_id, ref_id, name, ad_seconds, sort_order)
SELECT t.id, 'ads', 'Ads', t.ad_seconds, 0
FROM public.tenants t
WHERE EXISTS (SELECT 1 FROM public.ads a WHERE a.tenant_id = t.id);

UPDATE public.ads a
SET ad_set_id = s.id
FROM public.ad_sets s
WHERE s.tenant_id = a.tenant_id AND a.ad_set_id IS NULL;

DELETE FROM public.ads WHERE ad_set_id IS NULL;

ALTER TABLE public.ads ALTER COLUMN ad_set_id SET NOT NULL;

CREATE INDEX ads_ad_set_id_idx ON public.ads (ad_set_id);