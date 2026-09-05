# Running it yourself (Docker + SQLite)

The app runs in two variants from the same source:

- **Cloud** (`BACKEND=cloud`, default) — hosted database, file storage and scheduling.
- **Self-hosted** (`BACKEND=local`) — everything inside one container: a SQLite
  database file and all uploaded images on a mounted volume, live updates and
  webhook scheduling in-process. No external service, no internet needed except
  for outgoing webhooks.

## Start

```bash
docker compose up -d --build
```

Open http://localhost:3000. The database and image folders are created
automatically inside the volume on first start.

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

## Configuration

See `.env.example`. Useful values:

- `PORT` — HTTP port (default 3000)
- `DATA_DIR` — data location inside the container (default `/data`)
- `SESSION_SECRET` — set it to keep PIN logins valid across volume resets
- `PUBLIC_BASE_URL` — used internally for scheduled webhook posts

## Build without Docker

```bash
BACKEND=local NITRO_PRESET=node-server bun run build
BACKEND=local DATA_DIR=./data node .output/server/index.mjs
```

Requires Node 24 or newer (uses the built-in SQLite support).
