ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS template text NOT NULL DEFAULT 'zeitplan';

-- Migrate existing room.tag values into entries.tags so name-based matching works
UPDATE public.entries e
SET tags = ARRAY(
  SELECT DISTINCT r.name
  FROM public.rooms r
  WHERE r.tenant_id = e.tenant_id AND r.tag = ANY(e.tags)
)
WHERE cardinality(e.tags) > 0;

ALTER TABLE public.rooms DROP COLUMN IF EXISTS tag;
ALTER TABLE public.rooms DROP COLUMN IF EXISTS template;