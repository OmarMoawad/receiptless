import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { merchantReceiptSchema } from "@/lib/validation";

/**
 * Simulates the merchant/terminal side of the claim-token protocol
 * (ROADMAP.md, Phase 1): a POS or payment terminal calls this at the point
 * of sale to create an authoritative receipt server-side, then encodes only
 * an opaque claim token in the QR/NFC payload handed to the customer — never
 * the receipt data itself. Real deployment requires per-merchant API keys
 * and rate limiting (see roadmap); this MVP endpoint is unauthenticated and
 * intended for local/demo use only.
 */
export async function POST(request: NextRequest) {
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

  const merchant = await prisma.merchant.upsert({
    where: { name: data.merchant },
    update: data.merchantWebsite ? { website: data.merchantWebsite } : {},
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
