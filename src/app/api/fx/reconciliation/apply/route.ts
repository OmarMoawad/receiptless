import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { applyFxReconciliationInputSchema } from "@/lib/validation";
import {
  applyFxReconciliation,
  StaleReportingCurrencyError,
  type ApplyFxReconciliationInput,
} from "@/lib/fx/reconciliation-service";

/**
 * Phase 2 session 8 — apply one bounded batch of FX reconciliation.
 *
 * Stricter-limited than preview because a batch can reach the rate
 * provider and writes conversion rows. The owner comes from the session;
 * the body carries only a cursor, a limit (≤10, enforced by the schema),
 * the exact reporting currency the preview was run against, and the run's
 * correlation id. A preview that is stale — the owner changed their
 * reporting currency since — is refused with 409 rather than reconciling
 * to a currency they no longer use.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["fx-reconciliation-apply"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = applyFxReconciliationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reconciliation request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await applyFxReconciliation(user.userId, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      expectedReportingCurrency: parsed.data.expectedReportingCurrency,
      // The schema has already proven the `fx-reconciliation:<uuid>` shape.
      correlationId: parsed.data.correlationId as ApplyFxReconciliationInput["correlationId"],
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof StaleReportingCurrencyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
