export const CATEGORIES = [
  "GROCERIES",
  "DINING",
  "TRANSPORT",
  "UTILITIES",
  "HEALTH",
  "SHOPPING",
  "ENTERTAINMENT",
  "TRAVEL",
  "EDUCATION",
  "OTHER",
] as const;

export type CategoryName = (typeof CATEGORIES)[number];

/**
 * What a rule reads. A merchant rule sees the merchant name and decides a
 * whole receipt; an item rule sees one line item's name. They are separate
 * because they answer different questions — "Tesco" says grocery shop,
 * "paracetamol" says the pharmacy aisle of it, and a receipt is often
 * both.
 */
export type RuleTarget = "MERCHANT" | "ITEM";

export type CategoryRule = {
  /** Matched case-insensitively as a substring of the normalised text. */
  pattern: string;
  category: CategoryName;
  target: RuleTarget;
  /** Lower runs first. Ties break on pattern length, longest first. */
  priority: number;
};

/**
 * Substring matching, deliberately, rather than regular expressions.
 *
 * A user-authored regex is two problems: it is a denial-of-service vector
 * (catastrophic backtracking on a pattern the author did not realise was
 * pathological, evaluated server-side over every item of every receipt),
 * and it is hard to predict — "why did this rule fire?" is a question
 * people should be able to answer by reading their own rule. A substring
 * is boring, and boring is the correct property for a classifier whose
 * output lands in someone's tax summary.
 *
 * Normalisation folds case, collapses whitespace and strips punctuation,
 * so `STARBUCKS #1174` and `Starbucks` are the same haystack — receipt
 * merchant names are full of store numbers and separators that nobody
 * should have to write a rule around.
 */
export function normaliseForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(rule: CategoryRule, text: string): boolean {
  const pattern = normaliseForMatching(rule.pattern);
  return pattern.length > 0 && normaliseForMatching(text).includes(pattern);
}

/**
 * Starting points, not tax advice and not a taxonomy anyone should trust
 * blindly. They exist so a new vault classifies *something* on day one
 * rather than filing everything under OTHER until the owner writes ten
 * rules by hand — the same reason the warranty columns were seeded in
 * Phase 0.
 *
 * Owner rules always win over these (see `resolveCategory`), so a default
 * that is wrong for someone's spending is overridden rather than argued
 * with. Priority 1000 leaves the whole range below it free for rules a
 * person writes.
 */
export const DEFAULT_RULES: readonly CategoryRule[] = [
  // Merchants
  { pattern: "supermarket", category: "GROCERIES", target: "MERCHANT", priority: 1000 },
  { pattern: "grocer", category: "GROCERIES", target: "MERCHANT", priority: 1000 },
  { pattern: "market", category: "GROCERIES", target: "MERCHANT", priority: 1010 },
  { pattern: "cafe", category: "DINING", target: "MERCHANT", priority: 1000 },
  { pattern: "coffee", category: "DINING", target: "MERCHANT", priority: 1000 },
  { pattern: "restaurant", category: "DINING", target: "MERCHANT", priority: 1000 },
  { pattern: "pizza", category: "DINING", target: "MERCHANT", priority: 1000 },
  { pattern: "bakery", category: "DINING", target: "MERCHANT", priority: 1000 },
  { pattern: "pharmacy", category: "HEALTH", target: "MERCHANT", priority: 1000 },
  { pattern: "clinic", category: "HEALTH", target: "MERCHANT", priority: 1000 },
  { pattern: "hospital", category: "HEALTH", target: "MERCHANT", priority: 1000 },
  { pattern: "airlines", category: "TRAVEL", target: "MERCHANT", priority: 1000 },
  { pattern: "hotel", category: "TRAVEL", target: "MERCHANT", priority: 1000 },
  { pattern: "airport", category: "TRAVEL", target: "MERCHANT", priority: 1000 },
  { pattern: "taxi", category: "TRANSPORT", target: "MERCHANT", priority: 1000 },
  { pattern: "uber", category: "TRANSPORT", target: "MERCHANT", priority: 1000 },
  { pattern: "fuel", category: "TRANSPORT", target: "MERCHANT", priority: 1000 },
  { pattern: "petrol", category: "TRANSPORT", target: "MERCHANT", priority: 1000 },
  { pattern: "railway", category: "TRANSPORT", target: "MERCHANT", priority: 1000 },
  { pattern: "electric", category: "UTILITIES", target: "MERCHANT", priority: 1000 },
  { pattern: "water", category: "UTILITIES", target: "MERCHANT", priority: 1010 },
  { pattern: "telecom", category: "UTILITIES", target: "MERCHANT", priority: 1000 },
  { pattern: "internet", category: "UTILITIES", target: "MERCHANT", priority: 1000 },
  { pattern: "cinema", category: "ENTERTAINMENT", target: "MERCHANT", priority: 1000 },
  { pattern: "theatre", category: "ENTERTAINMENT", target: "MERCHANT", priority: 1000 },
  { pattern: "bookshop", category: "EDUCATION", target: "MERCHANT", priority: 1000 },
  { pattern: "university", category: "EDUCATION", target: "MERCHANT", priority: 1000 },

  // Items
  { pattern: "paracetamol", category: "HEALTH", target: "ITEM", priority: 1000 },
  { pattern: "ibuprofen", category: "HEALTH", target: "ITEM", priority: 1000 },
  { pattern: "prescription", category: "HEALTH", target: "ITEM", priority: 1000 },
  { pattern: "vitamin", category: "HEALTH", target: "ITEM", priority: 1000 },
  { pattern: "textbook", category: "EDUCATION", target: "ITEM", priority: 1000 },
  { pattern: "notebook", category: "EDUCATION", target: "ITEM", priority: 1000 },
  { pattern: "milk", category: "GROCERIES", target: "ITEM", priority: 1000 },
  { pattern: "bread", category: "GROCERIES", target: "ITEM", priority: 1000 },
  { pattern: "eggs", category: "GROCERIES", target: "ITEM", priority: 1000 },
  { pattern: "coffee", category: "DINING", target: "ITEM", priority: 1010 },
  { pattern: "latte", category: "DINING", target: "ITEM", priority: 1000 },
  { pattern: "ticket", category: "TRANSPORT", target: "ITEM", priority: 1010 },
];

/**
 * The first rule that matches, in precedence order. Returns `null` rather
 * than `OTHER` when nothing matches, so a caller can tell "no rule had an
 * opinion" apart from "a rule decided this is OTHER" — the difference
 * matters when deciding whether to overwrite a category a person chose.
 */
export function resolveCategory(
  text: string,
  target: RuleTarget,
  ownerRules: readonly CategoryRule[] = [],
): CategoryName | null {
  const applicable = [...ownerRules, ...DEFAULT_RULES]
    .filter((rule) => rule.target === target)
    .sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length);

  return applicable.find((rule) => matches(rule, text))?.category ?? null;
}

/**
 * Which rule fired, for showing a person *why* their receipt was filed
 * where it was. Session 3 made search explain its matches for the same
 * reason: a classification nobody can interrogate is one nobody can
 * correct.
 */
export function explainCategory(
  text: string,
  target: RuleTarget,
  ownerRules: readonly CategoryRule[] = [],
): { category: CategoryName; rule: CategoryRule; source: "owner" | "default" } | null {
  const owned = new Set(ownerRules);
  const applicable = [...ownerRules, ...DEFAULT_RULES]
    .filter((rule) => rule.target === target)
    .sort((a, b) => a.priority - b.priority || b.pattern.length - a.pattern.length);

  const rule = applicable.find((candidate) => matches(candidate, text));
  if (!rule) return null;
  return { category: rule.category, rule, source: owned.has(rule) ? "owner" : "default" };
}
