import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * The caller's own connections. Deliberately selects field by field rather
 * than returning the row: encryptedTokenData must never leave the backend,
 * and an explicit select means adding a sensitive column later can't
 * silently start exposing it.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const connections = await prisma.emailConnection.findMany({
    where: { userId: user.userId },
    select: {
      id: true,
      provider: true,
      status: true,
      providerAccountEmail: true,
      lastScannedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ connections });
}
