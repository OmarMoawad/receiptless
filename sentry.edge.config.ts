/**
 * Session 10 Part B. Edge runtime (middleware, edge routes).
 * See sentry.server.config.ts — same options, different runtime.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability";

Sentry.init(sentryOptions());
