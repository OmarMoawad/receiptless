import { NextRequest, NextResponse } from "next/server";
import { isDeployedEnvironment } from "@/lib/deployment";
import { runMaintenance } from "@/lib/maintenance";

/**
 * The scheduled half of housekeeping — see `vercel.json`'s `crons` entry,
 * which calls this once a day.
 *
 * A cron rather than the opportunistic prune that shipped with rate
 * limiting: that one runs at most once per instance per hour, from
 * whichever request happens to notice, so an instance that never gets a
 * request never prunes and nothing cleans the `Session` table at all.
 * The opportunistic prune stays, because it is what keeps local
 * development and any non-Vercel host tidy; this is the one that is
 * actually guaranteed to run somewhere.
 *
 * GET because that is what Vercel Cron issues. It is a mutating GET,
 * which is normally worth avoiding — the justification is that the
 * platform's scheduler does not offer another verb, and the endpoint is
 * credential-gated rather than reachable by a browser.
 */
export const dynamic = "force-dynamic";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that
 * environment variable is set. **Fails closed in any deployed
 * environment**: with no secret configured this endpoint would be an
 * unauthenticated delete-rows button on the public internet, so it
 * refuses to run rather than defaulting to open — the same rule
 * `oauth-token-crypto.ts` applies to its encryption key, and the same
 * one `deployment.ts` exists to express.
 *
 * Locally, where the gate is not applied, it can be called directly so
 * the job is testable without a deployment.
 */
function isAuthorized(request: NextRequest, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET?.trim();

  if (!secret) return !isDeployedEnvironment(env);

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    // 404 rather than 401: an unauthenticated caller learns nothing about
    // whether a maintenance endpoint exists here at all.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await runMaintenance();
  return NextResponse.json({ status: "ok", ...result });
}
