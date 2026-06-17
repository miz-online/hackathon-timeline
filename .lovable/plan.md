# Room Board — Plan

A small multi-tenant web app for managing time-stamped entries that show up live on room display screens.

## Concepts

- **Tenant**: an organization, identified by a generated `tenant_key` (random URL-safe string). Whoever knows the key has full access. No login.
- **Room**: belongs to a tenant. Has a name, a `tag` (string used to filter entries), and a chosen display template.
- **Entry**: belongs to a tenant. Has a time, description, and an array of tags. An entry shows in a room if its tag list is empty (broadcast) or contains the room's tag.
- **Tenant setting**: `past_grace_minutes` — entries are hidden once `time + past_grace_minutes < now`.
- **Template**: starts with one — `zeitplan` (time-sorted pill list, styled after the uploaded PDF). Architecture leaves room for more later; each template ships with its own visuals baked in (no separate theming layer).

## User flows

1. **Landing (`/`)**: two actions — *Create new tenant* (generates key, shows it once with copy + warning, redirects to admin) or *Enter tenant key*.
2. **Tenant gate (`/tenant`)**: input for tenant key; stored in `localStorage` on success; redirects to admin.
3. **Admin (`/tenant/$tenantKey`)**:
   - Entries tab: list, create, edit, delete (time, description, tag chips).
   - Rooms tab: list, create, edit, delete (name, tag, template). Each row links to the display.
   - Settings tab: `past_grace_minutes`, tenant name, regenerate key (with confirmation).
4. **Room picker (`/tenant/$tenantKey/rooms`)**: grid of rooms; click to open display.
5. **Display (`/tenant/$tenantKey/room/$roomId`)**: fullscreen, auto-reconnecting SSE stream, renders the room's template with filtered + grace-cutoff entries. Re-runs the local grace-cutoff filter every **1 second** so past entries disappear without needing a server push (load is negligible).

## Realtime (SSE)

- Server route: `GET /api/public/stream/$tenantKey/$roomId` returns `text/event-stream`.
- On connect: server sends a `snapshot` event with the current visible entries + room config.
- On any entry/room/settings mutation for that tenant: server publishes an `update` event to all connected room streams for that tenant; each connection re-queries and emits its filtered view.
- Pub/sub uses Supabase Realtime Postgres changes as the transport (the SSE handler subscribes once per connection). Stateless workers safe.
- Client uses native `EventSource` with exponential-backoff reconnect.

## Display design (Zeitplan template)

Modeled directly on the uploaded PDF:

- White background, generous spacing.
- Each entry is a rounded **pill** (full pill-shape, ~64px tall on desktop). Left section is a solid **red** block (`#C0322B`-ish) with the time in bold white. Right section is white with a dark slate title, optional italic description below in muted gray. Thin red outline around the whole pill.
- Entries stacked vertically with comfortable gap (~24px). Long descriptions wrap; the pill grows in height.
- Tenant name shown small in a corner; current clock in the opposite corner. No logo placeholder unless the user adds one later.
- Font: clean geometric sans (Inter or similar) — bundled via @fontsource.
- Display auto-scales so 6–10 entries fit a 1080p TV without scrolling; overflow scrolls naturally.

## Security model

- Tenant key is the only credential. Treat it as a bearer token in the URL path.
- All server functions and the SSE route take `tenantKey` as input and scope every query by `tenant_id`.
- No PII. Display URLs are intentionally shareable within an org.
- DB tables are server-only via service role; `anon`/`authenticated` have no grants. SSE handler validates the key against `tenants` before subscribing.

## Out of scope (now)

- Authentication / per-user accounts
- Additional templates (architecture supports adding them; first release ships only `zeitplan`)
- Per-template visual customization, theming, logo upload
- Per-room or per-template grace period (tenant-level only)
- Reordering, recurring entries, attachments

---

## Technical section

**Stack**: TanStack Start + Lovable Cloud (Postgres + Realtime). Server logic via `createServerFn`; SSE via a server route under `/api/public/`.

**Routes**
- `src/routes/index.tsx` — landing.
- `src/routes/tenant/index.tsx` — tenant key entry / create.
- `src/routes/tenant/$tenantKey/index.tsx` — admin (tabs via search param).
- `src/routes/tenant/$tenantKey/rooms.tsx` — room picker.
- `src/routes/tenant/$tenantKey/room/$roomId.tsx` — display screen (Zeitplan template).
- `src/routes/api/public/stream.$tenantKey.$roomId.ts` — SSE endpoint.

**Components**
- `src/components/templates/ZeitplanTemplate.tsx` — pill-list rendering, self-contained styling.
- `src/components/admin/EntryForm.tsx`, `RoomForm.tsx`, `SettingsForm.tsx`.

**Server functions** (`src/lib/board.functions.ts`)
- `createTenant()` → returns `{ key }`.
- `getTenant({ key })`, `updateTenantSettings({ key, ... })`, `regenerateKey({ key })`.
- `listEntries({ key })`, `upsertEntry({ key, entry })`, `deleteEntry({ key, id })`.
- `listRooms({ key })`, `upsertRoom({ key, room })`, `deleteRoom({ key, id })`.
- `getRoomSnapshot({ key, roomId })` — returns room + filtered visible entries (used by SSE on connect and on update).

All use `supabaseAdmin` loaded inside the handler via `await import(...)`; every query filters by `tenant_id` derived from `key`. Mutations bump `updated_at`, triggering Realtime → SSE fan-out.

**SSE route**
- Validates `tenantKey` → resolves `tenant_id`, validates `roomId` belongs to tenant.
- Returns `ReadableStream` with `text/event-stream` headers (`Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`).
- Subscribes via `supabaseAdmin.channel(...)` to `entries`, `rooms`, `tenants` filtered by `tenant_id`. On any event, re-runs `getRoomSnapshot` and pushes an `update` event. 25s keepalive comment.
- On client disconnect, removes the channel.

**Migration**
```sql
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
create index on public.rooms(tenant_id);
create index on public.entries(tenant_id, time);

grant all on public.tenants, public.rooms, public.entries to service_role;
alter table public.tenants enable row level security;
alter table public.rooms   enable row level security;
alter table public.entries enable row level security;
-- No policies → only service role (server fns) reads/writes. Anon/authenticated blocked.
alter publication supabase_realtime add table public.entries, public.rooms, public.tenants;
```

**Tenant key**: 24 chars base32, generated server-side, collision-checked on insert.

**Visible-entry filter** (server + client): `time >= now() - interval 'past_grace_minutes' AND (cardinality(tags)=0 OR room.tag = any(tags))`, sorted ascending by `time`.

**Local re-filter**: display component runs a **1s `setInterval`** that re-applies the grace cutoff to the last snapshot.

---

## Open question

Anything to add to the first release? Possible follow-ups I'd defer: a "next up" template, CSV import/export, undo on delete, optional logo per tenant.