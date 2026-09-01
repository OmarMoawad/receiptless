import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { merchantErrorResponse } from "@/lib/merchant/http";
import { addMerchantMember } from "@/lib/merchant/service";
import { enforceRateLimit } from "@/lib/rate-limit";
import { addMerchantMemberInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Context = { params: Promise<{ accountId: string }> };

/**
 * Phase 3 Session 1. Add a member to an account. The route authenticates
 * the session and hands off to the service, which checks that the caller
 * holds `members.manage` before writing — the body never carries the acting
 * user, so a caller cannot act as someone else.
 */
export async function POST(request: NextRequest, context: Context) {
  const limited = await enforceRateLimit(request, ["merchant-admin"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { accountId } = await context.params;
  const parsed = addMerchantMemberInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid member", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await addMerchantMember(user.userId, accountId, parsed.data.userId, parsed.data.role);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return merchantErrorResponse(error);
  }
}
