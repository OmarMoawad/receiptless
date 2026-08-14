import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  agentRules: false,
};

/**
 * Session 10 Part B. The Sentry wrapper is applied unconditionally, but
 * the SDK itself is inert without a DSN (see src/lib/observability.ts's
 * `sentryEnabled`), so a local build or a fork with no Sentry account
 * behaves exactly as before.
 *
 * `silent` keeps the build log clean; source-map upload is skipped
 * automatically when SENTRY_AUTH_TOKEN is absent, which is why that
 * variable is optional in DEPLOYMENT.md.
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  // Server-side source maps are uploaded and then deleted from the
  // bundle, so stack traces are readable in Sentry without shipping
  // sources to browsers.
  widenClientFileUpload: true,
  disableLogger: true,
});
