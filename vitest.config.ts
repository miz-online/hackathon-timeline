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
      include: ["src/lib/**"],
      // Server-only modules with heavy env/DB side effects are not unit-testable;
      // exclude them so coverage reflects what the tests actually measure.
      exclude: [
        "src/lib/**/__tests__/**",
        "src/lib/**/*.{functions,server}.{ts,tsx}",
        "src/lib/i18n.tsx",
      ],
    },
  },
});

