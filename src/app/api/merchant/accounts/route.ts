import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMerchantAccount, listMerchantAccounts } from "@/lib/merchant/service";
import { MerchantConflictError } from "@/lib/merchant/types";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createMerchantAccountInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Phase 3 Session 1. The merchant administration surface — thin routes that
 * authenticate the session and delegate every decision to the merchant
 * service, which owns membership/role authorization. Consumer receipt
 * ownership is untouched by anything here.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const accounts = await listMerchantAccounts(user.userId);
  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["merchant-admin"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const parsed = createMerchantAccountInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid merchant account", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const account = await createMerchantAccount(user.userId, parsed.data);
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof MerchantConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
