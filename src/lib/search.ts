import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";

/**
 * Phase 2 session 3 — real search, replacing a substring match.
 *
 * What the substring version got wrong, beyond being unrankable:
 *
 * - **It was case-sensitive.** Prisma's `contains` without
 *   `mode: "insensitive"` compiles to `LIKE '%q%'`, and Postgres `LIKE` is
 *   case-sensitive — so searching `flat white` did not find `Flat white`.
 *   That is a search box that silently fails on the most natural way to
 *   type a query.
 * - **Every match was equal.** A receipt from a merchant called "Coffee"
 *   ranked the same as one with "coffee" buried in a note.
 * - **It could not use an index**, so it degraded with the vault.
 *
 * Full text fixes all three: stemming ("returns" finds "return"),
 * weighting (merchant > items > notes), ranking, and a GIN index.
 */

/** Why a receipt came back — see the note on honesty below. */
export type MatchedOn = {
  merchant: boolean;
  notes: boolean;
  /** The item names that matched, so the UI can show the actual reason. */
  items: string[];
  /**
   * True when the row came from the substring fallback rather than the
   * full-text index, so the UI never claims a relevance it does not have.
   */
  viaFallback: boolean;
};

export type ReceiptSearchHit = {
  receipt: Prisma.ReceiptGetPayload<{ include: { merchant: true; items: true } }>;
  rank: number;
  matchedOn: MatchedOn;
};

type RankedRow = {
  id: string;
  rank: number;
  matched_merchant: boolean;
  matched_notes: boolean;
  matched_items: string[];
};

const MAX_RESULTS = 50;

/**
 * `websearch_to_tsquery` rather than `plainto_tsquery`: it understands what
 * people actually type into a search box — quoted phrases, `or`, and `-`
 * to exclude — and it never throws on malformed input, which matters for a
 * string that comes straight from a URL parameter.
 */
async function fullTextSearch(ownerId: string, query: string, limit: number): Promise<RankedRow[]> {
  return prisma.$queryRaw<RankedRow[]>(Prisma.sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS query)
    SELECT
      r.id,
      ts_rank(r."searchVector", q.query) AS rank,
      (to_tsvector('english', m.name) @@ q.query) AS matched_merchant,
      (to_tsvector('english', coalesce(r.notes, '')) @@ q.query) AS matched_notes,
      ARRAY(
        SELECT i.name FROM "ReceiptItem" i
        WHERE i."receiptId" = r.id AND to_tsvector('english', i.name) @@ q.query
      ) AS matched_items
    FROM "Receipt" r
    JOIN "Merchant" m ON m.id = r."merchantId"
    CROSS JOIN q
    WHERE r."ownerId" = ${ownerId}
      AND r."searchVector" @@ q.query
    ORDER BY rank DESC, r."purchasedAt" DESC
    LIMIT ${limit}
  `);
}

/**
 * Full text matches whole words, so a half-typed query ("airp") finds
 * nothing — and to a user that is indistinguishable from owning no such
 * receipt. This runs only when the index returned nothing, and is
 * **case-insensitive**, which the old implementation was not.
 *
 * Deliberately unranked: there is no relevance here, only "contains", and
 * `viaFallback` says so rather than dressing it up as a score.
 */
async function substringFallback(ownerId: string, query: string, limit: number) {
  return prisma.receipt.findMany({
    where: {
      ownerId,
      OR: [
        { merchant: { name: { contains: query, mode: "insensitive" } } },
        { notes: { contains: query, mode: "insensitive" } },
        { items: { some: { name: { contains: query, mode: "insensitive" } } } },
      ],
    },
    include: { merchant: true, items: true },
    orderBy: { purchasedAt: "desc" },
    take: limit,
  });
}

/**
 * Owner-scoped by construction: `ownerId` is applied in both paths, and an
 * unclaimed receipt has no owner, so neither can surface one.
 */
export async function searchReceipts(
  ownerId: string,
  rawQuery: string,
  limit = MAX_RESULTS,
): Promise<ReceiptSearchHit[]> {
  const query = rawQuery.trim();
  if (!query) return [];
  const take = Math.min(limit, MAX_RESULTS);

  const ranked = await fullTextSearch(ownerId, query, take);

  if (ranked.length > 0) {
    const receipts = await prisma.receipt.findMany({
      where: { id: { in: ranked.map((row) => row.id) } },
      include: { merchant: true, items: true },
    });
    const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));

    // Ordered by the ranked query, not by the hydration query — findMany
    // makes no promise about order, and relying on it would produce a
    // ranking that is right in tests and wrong in production.
    return ranked.flatMap((row) => {
      const receipt = byId.get(row.id);
      if (!receipt) return [];
      return [
        {
          receipt,
          rank: Number(row.rank),
          matchedOn: {
            merchant: row.matched_merchant,
            notes: row.matched_notes,
            items: row.matched_items,
            viaFallback: false,
          },
        },
      ];
    });
  }

  const fallback = await substringFallback(ownerId, query, take);
  const needle = query.toLowerCase();
  return fallback.map((receipt) => ({
    receipt,
    rank: 0,
    matchedOn: {
      merchant: receipt.merchant.name.toLowerCase().includes(needle),
      notes: (receipt.notes ?? "").toLowerCase().includes(needle),
      items: receipt.items.filter((item) => item.name.toLowerCase().includes(needle)).map((item) => item.name),
      viaFallback: true,
    },
  }));
}

/** A short human explanation of why a receipt matched, for the UI. */
export function describeMatch(matchedOn: MatchedOn): string {
  const reasons: string[] = [];
  if (matchedOn.merchant) reasons.push("merchant");
  if (matchedOn.items.length > 0) reasons.push(matchedOn.items.join(", "));
  if (matchedOn.notes) reasons.push("notes");
  if (reasons.length === 0) return "";
  return `Matched ${reasons.join(" · ")}`;
}
