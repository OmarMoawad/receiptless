import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isMerchantApiEnabled } from "@/lib/deployment";
import { merchantReceiptSchema } from "@/lib/validation";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Simulates the merchant/terminal side of the claim-token protocol
 * (ROADMAP.md, Phase 1): a POS or payment terminal calls this at the point
 * of sale to create an authoritative receipt server-side, then encodes only
 * an opaque claim token in the QR/NFC payload handed to the customer — never
 * the receipt data itself. Real deployment requires per-merchant API keys
 * and rate limiting (see roadmap); this MVP endpoint is unauthenticated and
 * intended for local/demo use only — a constraint Session 8 turned from a
 * comment into an actual gate (see the check below).
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["merchant-api"]);
  if (limited) return limited;

  // Unauthenticated and unrate-limited: it creates receipts and claim
  // tokens for anyone who can reach it. Off by default in any deployed
  // environment; must be switched on explicitly. 404 rather than 403 so a
  // disabled deployment doesn't advertise that the endpoint exists.
  if (!isMerchantApiEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = merchantReceiptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid receipt payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // update is intentionally always {}, never re-setting website from this
  // call's input: this endpoint is unauthenticated (see the doc comment
  // above), so letting it overwrite an *existing* merchant's canonical
  // website would let anyone who knows a merchant name mutate shared
  // reference data. Only a brand-new Merchant row gets a website, from its
  // own creation payload. Revisit once Phase 3 merchant API keys exist and
  // an update path can be tied to an authenticated, authorized merchant.
  const merchant = await prisma.merchant.upsert({
    where: { name: data.merchant },
    update: {},
    create: { name: data.merchant, website: data.merchantWebsite },
  });

  const claimToken = randomBytes(16).toString("base64url");
  const claimTokenExpiresAt = new Date(
    Date.now() + data.claimTtlMinutes * 60_000
  );

  const receipt = await prisma.receipt.create({
    data: {
      merchantId: merchant.id,
      currency: data.currency,
      totalMinor: data.totalMinor,
      subtotalMinor: data.subtotalMinor,
      taxMinor: data.taxMinor,
      discountMinor: data.discountMinor,
      feeMinor: data.feeMinor,
      category: data.category,
      purchasedAt: new Date(data.purchasedAt),
      source: data.source,
      // This endpoint has no merchant authentication yet, so it cannot
      // honestly claim MERCHANT_VERIFIED — that label must mean "an
      // authenticated, authorized merchant key created this," which only
      // exists once Phase 3 (merchant API keys) lands. Until then, treat
      // this as a local simulator and mark output UNVERIFIED so the
      // verification field never overstates its guarantee.
      verification: "UNVERIFIED",
      rawPayload: data.rawPayload,
      claimToken,
      claimTokenExpiresAt,
      items: data.items ? { create: data.items } : undefined,
    },
    include: { merchant: true, items: true },
  });

  const origin = request.nextUrl.origin;
  return NextResponse.json(
    {
      receiptId: receipt.id,
      claimToken,
      claimTokenExpiresAt,
      claimUrlWeb: `${origin}/claim/${claimToken}`,
      claimUrlScheme: `receiptless://claim/${claimToken}`,
    },
    { status: 201 }
  );
}
