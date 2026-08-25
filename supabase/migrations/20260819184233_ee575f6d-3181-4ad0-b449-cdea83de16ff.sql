CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ref_id text,
  name text NOT NULL,
  members text NOT NULL DEFAULT '',
  project text NOT NULL DEFAULT '',
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.teams TO service_role;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams service only" ON public.teams FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER teams_touch_updated_at BEFORE UPDATE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenants ADD COLUMN practice_minutes integer NOT NULL DEFAULT 10;
ALTER TABLE public.tenants ADD COLUMN practice_room_scope text NOT NULL DEFAULT 'all';
ALTER TABLE public.entries ADD COLUMN kind text NOT NULL DEFAULT 'entry';

ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;