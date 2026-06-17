
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null default 'My organization',
  past_grace_minutes integer not null default 15,
  created_at timestamptz not null default now()
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  tag text not null,
  template text not null default 'zeitplan',
  created_at timestamptz not null default now()
);
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  time timestamptz not null,
  description text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_tenant_idx on public.rooms(tenant_id);
create index entries_tenant_time_idx on public.entries(tenant_id, time);

grant all on public.tenants to service_role;
grant all on public.rooms to service_role;
grant all on public.entries to service_role;

alter table public.tenants enable row level security;
alter table public.rooms   enable row level security;
alter table public.entries enable row level security;

-- No policies → anon/authenticated have no access; only service role.

alter publication supabase_realtime add table public.entries;
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.tenants;
alter table public.entries replica identity full;
alter table public.rooms   replica identity full;
alter table public.tenants replica identity full;

create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql set search_path = public;

create trigger entries_touch_updated_at before update on public.entries
  for each row execute function public.touch_updated_at();
