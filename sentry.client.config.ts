/**
 * Session 10 Part B. Browser-side error tracking.
 *
 * Only NEXT_PUBLIC_SENTRY_DSN is readable here — the server DSN is not
 * inlined into the client bundle, which is why the two variable names
 * exist rather than one.
 *
 * Session Replay is deliberately NOT enabled: it would record the receipt
 * vault on screen, which is the user's purchase history, and ship it to a
 * third party. The scrubbing in observability.ts would not help, because
 * replay captures the rendered DOM rather than an event payload.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability";

Sentry.init(sentryOptions());
