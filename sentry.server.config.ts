/**
 * Session 10 Part B. Server-side error tracking.
 *
 * All policy — scrubbing, enablement, environment — lives in
 * src/lib/observability.ts so it is testable and identical across the
 * three runtimes. These config files stay thin on purpose.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability";

Sentry.init(sentryOptions());
