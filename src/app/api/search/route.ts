import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchReceipts } from "@/lib/search";

/**
 * Vault search. Phase 2 session 3 replaced the substring match with
 * Postgres full text — see lib/search.ts for what the old one got wrong
 * (it was case-sensitive, unrankable, and unindexable).
 *
 * Session 3's tenant isolation is unchanged and enforced inside
 * `searchReceipts`: one user's search never surfaces another's receipts,
 * and an unclaimed receipt has no owner so it cannot appear either.
 *
 * The response keeps the receipt shape it always had, with `rank` and
 * `matchedOn` alongside — so an existing caller reading the receipt
 * fields keeps working.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);

  const hits = await searchReceipts(user.userId, q);
  return NextResponse.json(hits.map((hit) => ({ ...hit.receipt, rank: hit.rank, matchedOn: hit.matchedOn })));
}
