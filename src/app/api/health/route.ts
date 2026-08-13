import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isMerchantApiEnabled, missingProductionConfig } from "@/lib/deployment";

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
  let database: "ok" | "unreachable" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }

  const ready = database === "ok" && missingConfig.length === 0;
  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      database,
      missingConfig,
      merchantApiEnabled: isMerchantApiEnabled(),
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
