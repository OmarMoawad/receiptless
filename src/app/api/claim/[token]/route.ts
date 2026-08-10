import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Resolves a claim token from the QR claim-token protocol (see
 * merchant/receipts route and ROADMAP.md). The token is opaque and carries
 * no receipt data itself — this is the only place that data is fetched,
 * so it can be gated, expired, and (later) tied to a specific customer
 * identity instead of being embedded in a scannable image forever.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const receipt = await prisma.receipt.findUnique({
    where: { claimToken: token },
    include: { merchant: true, items: true },
  });

  if (!receipt) {
    return NextResponse.json({ error: "Claim token not found" }, { status: 404 });
  }

  if (receipt.claimTokenExpiresAt && receipt.claimTokenExpiresAt < new Date()) {
    return NextResponse.json({ error: "Claim token expired" }, { status: 410 });
  }

  if (!receipt.claimedAt) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { claimedAt: new Date() },
    });
  }

  return NextResponse.json(receipt);
}
