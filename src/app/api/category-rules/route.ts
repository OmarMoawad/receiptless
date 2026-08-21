import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { categoryRuleInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Session 6. A person's own classification rules. Owner-scoped at the
 * database boundary like every other route here — a rule is as personal
 * as the receipts it files.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const rules = await prisma.categoryRule.findMany({
    where: { ownerId: user.userId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["default-write"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const parsed = categoryRuleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rule", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { pattern, category, target, priority } = parsed.data;

  /**
   * Upsert rather than create: re-adding a pattern should edit the rule
   * that already exists, not fail with a constraint error the person
   * cannot act on, and not create a second rule that can never fire
   * because the first one always matches first.
   */
  const rule = await prisma.categoryRule.upsert({
    where: { ownerId_target_pattern: { ownerId: user.userId, target, pattern } },
    update: { category, priority },
    create: { ownerId: user.userId, pattern, category, target, priority },
  });

  return NextResponse.json(rule, { status: 201 });
}
