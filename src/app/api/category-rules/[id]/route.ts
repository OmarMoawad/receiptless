import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await enforceRateLimit(request, ["default-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await context.params;

  /**
   * `deleteMany` with the owner in the filter, not `delete` by id: a
   * delete that finds the row first and checks ownership after has a
   * window, and returning 404 for someone else's rule rather than 403
   * declines to confirm that the id exists at all.
   */
  const { count } = await prisma.categoryRule.deleteMany({
    where: { id, ownerId: user.userId },
  });

  if (count === 0) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
