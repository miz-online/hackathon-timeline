CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  path text NOT NULL,
  content_type text NOT NULL DEFAULT 'image/png',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ads TO service_role;

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ads service only" ON public.ads FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER ads_touch_updated_at BEFORE UPDATE ON public.ads
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX ads_tenant_idx ON public.ads (tenant_id, sort_order);

ALTER TABLE public.tenants ADD COLUMN ad_seconds integer NOT NULL DEFAULT 10;
ALTER TABLE public.rooms ADD COLUMN template text;