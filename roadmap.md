# Self-hostable Docker/SQLite variant

- [ ] 1. Create adapter architecture (`src/lib/db-adapter/`) with shared types and Cloud driver
- [ ] 2. Implement local SQLite driver covering all query shapes used by the app
- [ ] 3. Implement local file storage driver (logos, ads, entry backgrounds)
- [ ] 4. Implement local event bus for SSE live updates
- [ ] 5. Implement local in-process webhook scheduler
- [ ] 6. Replace all `supabaseAdmin`/`createClient` imports with adapter
- [ ] 7. Refactor webhook dispatch route to use adapter and shared dispatch logic
- [ ] 8. Make `attachSupabaseAuth` conditional so local mode works without Supabase env vars
- [ ] 9. Create consolidated SQLite schema and initialization
- [ ] 10. Add Dockerfile, docker-compose.yml, .env.example, README-selfhost.md
- [ ] 11. Configure Vite build-time alias so local driver is excluded from Cloud builds
- [ ] 12. Verify Cloud build/preview still works
- [ ] 13. Build and run Docker container; test tenant, entries, images, SSE, webhooks, import/export
