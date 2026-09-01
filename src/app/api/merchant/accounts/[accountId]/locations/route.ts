import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { merchantErrorResponse } from "@/lib/merchant/http";
import { createMerchantLocation, listMerchantLocations } from "@/lib/merchant/service";
import { enforceRateLimit } from "@/lib/rate-limit";
import { merchantLocationInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Context = { params: Promise<{ accountId: string }> };

/**
 * Phase 3 Session 1. List and create locations for one account. Reading
 * needs `locations.read` (every role); creating needs `locations.manage`
 * (OWNER/ADMIN). Both checks live in the service.
 */
export async function GET(request: NextRequest, context: Context) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { accountId } = await context.params;
  try {
    const locations = await listMerchantLocations(user.userId, accountId);
    return NextResponse.json({ locations });
  } catch (error) {
    return merchantErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  const limited = await enforceRateLimit(request, ["merchant-admin"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { accountId } = await context.params;
  const parsed = merchantLocationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid location", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const location = await createMerchantLocation(user.userId, accountId, parsed.data);
    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    return merchantErrorResponse(error);
  }
}
