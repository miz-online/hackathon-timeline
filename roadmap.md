# Self-hostable Docker/SQLite variant

- [x] 1. Adapter architecture (`src/lib/backend/`) with Cloud driver selection
- [x] 2. Local SQLite driver covering all query shapes used by the app
- [x] 3. Local file storage driver (logos, ads, entry backgrounds) + signed tokens
- [x] 4. Local event bus for SSE live updates
- [x] 5. Local in-process webhook scheduler
- [x] 6. Route all `supabaseAdmin` usage through the adapter
- [x] 7. Webhook dispatch route uses the adapter
- [x] 8. Auth attachment skipped when no Cloud env vars are present
- [x] 9. Consolidated SQLite schema + automatic column upgrades
- [x] 10. Dockerfile, docker-compose.yml, .env.example, README-selfhost.md
- [x] 11. Local driver loaded only at runtime (excluded from Cloud bundles)
- [x] 12. Cloud build/preview verified
- [x] 13. SQLite driver verified on Node 24 (records, defaults, files, scheduling)
