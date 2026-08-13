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
