import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { insecureProductionConfig, isMerchantApiEnabled, missingProductionConfig } from "@/lib/deployment";
import { sentryEnabled } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * Deployment readiness, for a platform health check and for a human
 * verifying a fresh deploy. Reports *which* configuration is missing
 * rather than a bare pass/fail, so a misconfigured deployment is diagnosed
 * in one request instead of one redeploy per missing variable.
 *
 * Deliberately reports no values, only key names and booleans — this
 * endpoint is unauthenticated, so it must never become a way to read
 * configuration out of a running deployment.
 */
export async function GET() {
  const missingConfig = missingProductionConfig();
  const insecureConfig = insecureProductionConfig();
  let database: "ok" | "unreachable" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }

  // Unsafe configuration fails readiness exactly like missing
  // configuration — a deployment holding real tokens under the public dev
  // key is not "degraded but serving", it is not fit to serve.
  const ready = database === "ok" && missingConfig.length === 0 && insecureConfig.length === 0;
  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      database,
      missingConfig,
      insecureConfig,
      merchantApiEnabled: isMerchantApiEnabled(),
      // Session 10 Part B: observability is an exit criterion, so it is
      // reportable rather than something you confirm by squinting at a
      // dashboard. A boolean only — never the DSN, which is configuration
      // and this endpoint is unauthenticated.
      //
      // Deliberately does NOT fail readiness: a deployment with no error
      // tracking is worse-operated, not unsafe to serve, and conflating
      // the two would make /api/health 503 on every fork and preview.
      errorTrackingEnabled: sentryEnabled(),
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
