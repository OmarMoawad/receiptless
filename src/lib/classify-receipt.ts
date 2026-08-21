import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  type CategoryName,
  type CategoryRule,
  type RuleTarget,
  resolveCategory,
} from "./categories";

/**
 * Session 6. The bridge between the pure rules in `categories.ts` and the
 * database: load one owner's rules, apply them to a receipt and its items.
 *
 * Kept out of `categories.ts` on purpose — the matching logic is worth
 * testing without a database, and it stays that way only if nothing in it
 * imports Prisma.
 */
export async function ownerRules(
  ownerId: string,
  /**
   * The email ingestion path classifies inside its own transaction, so it
   * has to read rules through the same client — a read on a second
   * connection could see a rule the transaction has not committed, or
   * miss one it has.
   */
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CategoryRule[]> {
  const rows = await client.categoryRule.findMany({
    where: { ownerId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((row) => ({
    pattern: row.pattern,
    category: row.category as CategoryName,
    target: row.target as RuleTarget,
    priority: row.priority,
  }));
}

/**
 * Whether a category on an incoming receipt represents a choice or a
 * default.
 *
 * `OTHER` is the schema default, so it arrives both from someone who
 * genuinely means "none of these" and from every client that simply did
 * not say. Those are indistinguishable in the payload, and the rules
 * layer has to pick one reading. It treats `OTHER` as "no opinion" and
 * classifies over it, because the alternative — never classifying unless
 * a person first picks a category — makes the rules layer useless for the
 * ingestion paths that have no UI at all (email, the merchant API), which
 * are exactly the ones that need it.
 *
 * A person who really means OTHER can say so with a rule, and their rule
 * wins. That is the escape hatch, and it is why owner rules outrank
 * defaults.
 */
function isUnclassified(category: CategoryName): boolean {
  return category === "OTHER";
}

export type ClassifiableReceipt = {
  merchantName: string;
  category: CategoryName;
  items?: { name: string; category?: CategoryName }[];
};

export type ClassifiedReceipt = {
  category: CategoryName;
  items: CategoryName[];
};

/**
 * Applies rules without overwriting a deliberate choice.
 *
 * An item falls back to the receipt's category rather than to `OTHER`:
 * one line on a restaurant bill that no rule recognises is still part of
 * a restaurant bill, and filing it under OTHER would split a single
 * purchase across two categories in the tax summary for no reason a
 * person would recognise as sensible.
 */
export function classifyReceipt(
  receipt: ClassifiableReceipt,
  rules: readonly CategoryRule[],
): ClassifiedReceipt {
  const category = isUnclassified(receipt.category)
    ? (resolveCategory(receipt.merchantName, "MERCHANT", rules) ?? receipt.category)
    : receipt.category;

  const items = (receipt.items ?? []).map((item) => {
    if (item.category && !isUnclassified(item.category)) return item.category;
    return resolveCategory(item.name, "ITEM", rules) ?? category;
  });

  return { category, items };
}

/** The same thing, for a caller that has an owner id and not their rules. */
export async function classifyForOwner(
  ownerId: string,
  receipt: ClassifiableReceipt,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ClassifiedReceipt> {
  return classifyReceipt(receipt, await ownerRules(ownerId, client));
}
