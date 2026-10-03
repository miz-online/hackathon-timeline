import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "cobertura"],
      reportsDirectory: "coverage",
      include: ["src/lib/**", "src/routes/api/**"],
      // Only thin wrappers around external systems (driver selection, raw DB
      // handle, image codec, client auth plumbing, pure type contracts) and
      // the translation table are excluded; all app logic counts.
      exclude: [
        "src/lib/**/__tests__/**",
        "src/lib/i18n.tsx",
        "src/lib/backend/admin.server.ts",
        "src/lib/backend/sqlite-db.server.ts",
        "src/lib/backend/auth-attach.ts",
        "src/lib/image-grey.server.ts",
        "src/lib/storage/provider.server.ts",
      ],
    },
  },
});

