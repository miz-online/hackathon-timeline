# Self-hostable variant: Docker + SQLite alongside Lovable Cloud

Goal: the app runs unchanged on Lovable Cloud (variant 1) or fully self-contained in a single Docker container with a SQLite file on a mounted volume (variant 2). One codebase, one env switch.

## How it works

A `BACKEND` environment variable selects the driver at server start:

- `BACKEND=cloud` (default) — today's behaviour: Cloud database, Cloud file storage, database-scheduled webhook dispatch.
- `BACKEND=local` — SQLite database file, files on disk, in-process scheduler. No external service, no internet dependency except outgoing webhooks.

All backend access already goes through one server-side client object. That object becomes an adapter with two drivers, so the ~200 existing data calls stay exactly as they are. Nothing in the UI changes; features (rooms, entries, teams, ads, backgrounds, webhooks, PIN protection, im-/export, live updates) behave identically in both variants.

## What gets abstracted

1. **Database** — a small compatible query layer over SQLite covering exactly the query shapes the app uses (select with column lists, filters, ordering, single/maybe-single, insert/update/delete, returning rows). UUID ids, timestamps and text-array columns (`tags`, `notified_teams`) are stored in SQLite-friendly form and translated at the boundary, so records look the same to app code.
2. **File storage** — the three buckets (logos, ads, entry backgrounds) become directories under the data volume. Upload, download, delete, list, and the signed-URL calls used for ad previews map to short-lived local tokens served by the existing public file routes.
3. **Live updates (SSE)** — Cloud uses database change streams. Local uses an in-process event bus: every write through the adapter publishes a change event, and the existing SSE route subscribes to it. The client-side snapshot/poll fallback already in place keeps behaviour identical.
4. **Webhook scheduling** — Cloud keeps the database cron + RPC pair. Local computes the next due moment in Node with the same rules (entries and per-team slots, grace period) and arms a single timer, re-armed whenever entries, teams, webhooks or tenant settings change. The "next dispatch at" display in the Webhooks settings works in both.
5. **Session secret** — one server-wide env variable used to encrypt PIN session cookies; the Docker setup generates it on first start if not provided, so PIN sessions survive container restarts. The per-tenant PIN hash itself stays in the database (as today).
6. **Image helpers and greyscale conversion** — already pure JS, kept as-is; only the runtime target changes.

## SQLite schema

One consolidated schema file mirroring today's tables (`tenants`, `rooms`, `color_schemes`, `entries`, `teams`, `ads`, `ad_sets`, `webhooks`) with the same columns, defaults and foreign keys, plus the `updated_at` touch and "reset notified state when time changes" behaviour implemented in the adapter. It is applied automatically on container start and is idempotent, so restarts and upgrades are safe. Row-level policies are not needed locally — the container is the trust boundary; the PIN protection remains the admin gate.

Moving data from Cloud to a local instance uses the existing ZIP im-/export per tenant.

## Docker setup

- `Dockerfile` — multi-stage: build the app, then run it on Node in a slim image.
- `docker-compose.yml` — one service, port mapping, `BACKEND=local`, and a single volume mounted at `/data` holding `app.db` plus the `logos/`, `ads/`, `entry-backgrounds/` folders.
- `.env.example` and a short `README-selfhost.md` covering start, backup (copy the volume), and the optional session secret.

## Technical notes

- The Cloud build targets an edge runtime; the Docker build uses the Node server target of the same build so long-lived SSE connections and the in-process timer work. Both builds come from the same source.
- Adapter lives in server-only modules; the driver is chosen once, lazily, inside server handlers so no local-only code reaches the browser bundle.
- Cloud env variables stay untouched; when `BACKEND=local` they are not required at all.
- SQLite is opened in WAL mode with a busy timeout; writes are serialized in-process, which is sufficient for a single-container deployment.

## Verification

- Cloud variant: existing admin flows, room display, SSE push and webhook scheduling still work in preview.
- Local variant: container builds and starts on an empty volume, tenant creation, entry/team/ads editing, image upload, room display with live push, PIN lock/unlock, ZIP import of a Cloud export, and restart-persistence of database and images.
