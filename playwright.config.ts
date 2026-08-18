import { defineConfig } from "@playwright/test";

/**
 * External review finding #12. `npm run smoke` walks the same journey
 * over `fetch`, and its own header admits the limitation: it cannot see a
 * component that throws at render, a hydration mismatch, a control that
 * does nothing when clicked, or a client-side navigation that never
 * arrives. Every one of those ships a page that returns 200 and is
 * useless to a human — which is precisely the class of bug that reached
 * production in session 10 (a backend with no reachable UI, twice).
 *
 * So this runs a real browser against a real build. Not a replacement for
 * the fetch smoke test: that one runs against a *deployment* with no
 * dependencies, this one needs a browser binary and a database. They
 * answer different questions.
 */
export default defineConfig({
  testDir: "./e2e",
  // A real browser against a real build is slower than everything else in
  // this repo; the per-test ceiling exists so a hang fails rather than
  // stalling CI.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Serial: the journey registers accounts against one shared local
  // Postgres, and the suite already knows what parallel workers on one
  // database do to it (RECEIPTLESS_STATE.md's flake notes).
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    // Kept only for a failure, so a green run leaves nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  /**
   * `next start` on a port of its own, so an already-running `npm run dev`
   * is neither used nor disturbed — a dev server would also hide exactly
   * the production-only problems this is here to catch.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next start --port 3100",
        port: 3100,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
