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

## Configure

All configuration is done with environment variables. The easiest way is to
edit `docker-compose.yml` or create a `.env` file next to it:

```bash
# .env example
data
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
docker run -d -p 3000:3000 -v timeline-data:/data ghcr.io/<owner>/<repo>:latest
```
