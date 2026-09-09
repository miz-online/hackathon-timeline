# Timeline / Hackathon Schedule

A web app for centrally managing time entries and displaying them on multiple
configurable room screens. It supports live updates, team practice slots,
ads rotation, webhook notifications, and self-registration.

The same codebase runs on Lovable Cloud or fully self-contained in Docker with
SQLite storage.

## Functionality overview

- **Tenants** — Organisations are separated by a generated tenant key. Each
tenant has its own rooms, entries, teams, ads, color scheme, logo, and PIN-protected admin settings.
- **Rooms** — A room is both a display destination and a tag for entries. The
special *Overview / Übersicht* room shows all entries at once.
- **Entries** — Time-sorted schedule items with title, description, optional end
time, room tags, optional background image/tint, and color scheme override.
Entries can be edited individually or through a JSON editor.
- **Live display** — Room screens auto-update via SSE. Entries fade in/out,
grace-period items glow red, and relative times switch to "NOW / JETZT" and
"in x min".
- **Focus mode** — Highlight a configurable number of upcoming entries or all
entries within a time window; older entries are dimmed.
- **Teams & team time** — Manage teams, assign them to rooms, and generate
practice-time entries that expand into per-team slots with automatic end-time
calculation.
- **Slides** — Upload images, set display duration per image, and let rooms cycle
through full-screen slides with cross-fade transitions. Each slide set can hide
the room name, clock and logo for image-only displays.
- **Webhooks & direct messages** — Configure webhook endpoints (e.g. Discord)
that fire when entries become due. Direct messages can be sent manually.
- **Import / Export** — Export all tenant data (database, settings, images) as
a ZIP and import it into another instance.
- **Self-registration** — Teams can register themselves via a generated link and
edit their data later.
- **PIN protection** — Tenant admin access is protected by a PIN / password,
stored hashed, with sessions kept in a 4-hour sliding cookie.

## Deployment variants

- **Cloud** (`BACKEND=cloud`, default) — hosted database, file storage and scheduling.
- **Self-hosted** (`BACKEND=local`) — everything inside one Docker container:
SQLite database, uploaded images on a mounted volume, live updates and webhook
scheduling in-process. No external service, no internet needed except for
outgoing webhooks.

## Quick start with Docker

```bash
docker compose up -d --build
```

Open http://localhost:3000. The database and image folders are created
automatically inside the volume on first start.

## Configure

All configuration is done with environment variables. The easiest way is to
edit `docker-compose.yml` or create a `.env` file next to it:

```bash
# .env example
BACKEND=local
DATA_DIR=/data
PORT=3000
PUBLIC_BASE_URL=http://127.0.0.1:3000
# SESSION_SECRET=change-me-to-a-random-32-byte-hex-string
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKEND` | `cloud` | Must be `local` for the Docker image. |
| `DATA_DIR` | `/data` | Where SQLite and uploaded files are stored. |
| `PORT` | `3000` | HTTP port inside the container. |
| `PUBLIC_BASE_URL` | — | External URL used for scheduled webhook posts. |
| `SESSION_SECRET` | auto-generated | Key for PIN session cookies. |

The `SESSION_SECRET` is generated automatically on first start and persisted in
the volume at `/data/session-secret`. Set it explicitly if you want PIN logins
to survive a complete volume reset.

### Change the host port

Edit `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"
```

Then open http://localhost:8080.

## Data

Everything lives under `/data` in the container (volume `timeline-data`):

```
/data/app.db                      database
/data/storage/tenant-logos/       logos
/data/storage/tenant-ads/         ads
/data/storage/entry-backgrounds/  entry background images
/data/session-secret              generated cookie secret
```

Backup = stop the container and copy the volume. Upgrades keep existing data;
new columns are added automatically on start.

## Moving data from the hosted version

Use the built-in **Import/Export** tab: export the ZIP in the hosted app and
import it here. Images, entries, teams, rooms, ads and settings come along;
webhook URLs are intentionally not exported and must be re-entered.

## Build without Docker

```bash
BACKEND=local NITRO_PRESET=node-server bun run build
BACKEND=local DATA_DIR=./data node .output/server/index.mjs
```

Requires Node 24 or newer (uses the built-in SQLite support).

## Automatic image builds

A GitHub Actions workflow (`.github/workflows/docker-image.yml`) builds the
image on every push to `main`, on version tags (`v*`), and for pull requests
(build only, no publish). Published images land in the repository's GitHub
Container Registry:

```bash
docker run -d -p 3000:3000 -v timeline-data:/data ghcr.io/miz-online/hackathon-timeline:latest
```
