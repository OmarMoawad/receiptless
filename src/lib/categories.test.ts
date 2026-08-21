import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  type CategoryRule,
  explainCategory,
  normaliseForMatching,
  resolveCategory,
} from "./categories";

const ownerRule = (over: Partial<CategoryRule> = {}): CategoryRule => ({
  pattern: "corner shop",
  category: "GROCERIES",
  target: "MERCHANT",
  priority: 100,
  ...over,
});

describe("normalisation", () => {
  it("folds the noise real merchant names carry", () => {
    expect(normaliseForMatching("STARBUCKS #1174")).toBe("starbucks 1174");
    expect(normaliseForMatching("Tesco   Express,  Ltd.")).toBe("tesco express ltd");
  });

  it("keeps letters from any script rather than only ASCII", () => {
    expect(normaliseForMatching("Café Böhme")).toBe("café böhme");
    expect(normaliseForMatching("مطعم الشام")).toBe("مطعم الشام");
  });
});

describe("resolving a category", () => {
  it("matches a built-in default on a real-looking merchant name", () => {
    expect(resolveCategory("Blue Bottle Coffee #12", "MERCHANT")).toBe("DINING");
  });

  it("returns null when nothing has an opinion, rather than guessing OTHER", () => {
    // The distinction the whole classify step depends on: "no rule
    // matched" must be tellable from "a rule said OTHER".
    expect(resolveCategory("Zzyzx Holdings", "MERCHANT")).toBeNull();
  });

  it("lets an owner rule beat a built-in default", () => {
    // "market" is a default GROCERIES merchant rule; this owner sells at
    // one, so for them it is work.
    const rules = [ownerRule({ pattern: "market", category: "SHOPPING" })];
    expect(resolveCategory("Camden Market", "MERCHANT")).toBe("GROCERIES");
    expect(resolveCategory("Camden Market", "MERCHANT", rules)).toBe("SHOPPING");
  });

  it("keeps merchant rules and item rules apart", () => {
    const rules = [ownerRule({ pattern: "coffee", category: "SHOPPING", target: "ITEM" })];
    expect(resolveCategory("Coffee House", "MERCHANT", rules)).toBe("DINING");
    expect(resolveCategory("coffee beans", "ITEM", rules)).toBe("SHOPPING");
  });

  it("prefers the longer pattern when two rules share a priority", () => {
    const rules = [
      ownerRule({ pattern: "shop", category: "SHOPPING" }),
      ownerRule({ pattern: "corner shop", category: "GROCERIES" }),
    ];
    expect(resolveCategory("The Corner Shop", "MERCHANT", rules)).toBe("GROCERIES");
  });

  it("ignores a rule whose pattern normalises to nothing", () => {
    // "###" is all punctuation, so it would otherwise become an empty
    // substring — which matches every string in existence.
    const rules = [ownerRule({ pattern: "###", category: "TRAVEL" })];
    expect(resolveCategory("Anywhere At All", "MERCHANT", rules)).toBeNull();
  });
});

describe("explaining a category", () => {
  it("names the rule that fired and where it came from", () => {
    const rules = [ownerRule({ pattern: "tesco", category: "GROCERIES" })];
    expect(explainCategory("Tesco Express", "MERCHANT", rules)).toMatchObject({
      category: "GROCERIES",
      source: "owner",
    });
    expect(explainCategory("Blue Bottle Coffee", "MERCHANT")).toMatchObject({
      category: "DINING",
      source: "default",
    });
  });

  it("agrees with resolveCategory on every default rule", () => {
    // The two functions sort independently; if they ever disagree, the
    // explanation shown to a person would name a rule that did not
    // actually decide their receipt.
    for (const rule of DEFAULT_RULES) {
      const resolved = resolveCategory(rule.pattern, rule.target);
      expect(explainCategory(rule.pattern, rule.target)?.category).toBe(resolved);
    }
  });
});
