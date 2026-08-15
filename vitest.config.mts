import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    /**
     * Runs before any test opens a connection. This suite is destructive
     * against a real Postgres, so it refuses to run unless DATABASE_URL is
     * local — see src/test/guard-local-database.ts for why a hosted
     * database can end up in .env by accident.
     */
    setupFiles: ["src/test/guard-local-database.ts"],
    /**
     * Every test file shares one real Postgres (no mocked DB — see
     * README). Vitest defaults to a worker per core, and past roughly four
     * the suite starts producing failures that have nothing to do with the
     * code: connection contention makes unrelated tenant-isolation and
     * auth cases fail in a full run while passing in isolation. That has
     * been misread as a regression more than once, including by a
     * reviewer, so the cap lives here rather than depending on whoever
     * remembers to pass --maxWorkers.
     *
     * Raise this only alongside a real fix for the shared-database
     * contention (a schema or database per worker), not on its own.
     */
    maxWorkers: 4,
  },
});
