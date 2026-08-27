-- Team self-registration: registration entries and self-registered teams.

alter table public.entries
  add column if not exists register_token text;

create unique index if not exists entries_register_token_key
  on public.entries (register_token)
  where register_token is not null;

alter table public.teams
  add column if not exists edit_code text,
  add column if not exists self_registered boolean not null default false;

create unique index if not exists teams_edit_code_key
  on public.teams (edit_code)
  where edit_code is not null;

alter table public.tenants
  add column if not exists team_edit_locked boolean not null default false;
