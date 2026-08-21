import { describe, expect, it } from "vitest";
import type { CategoryRule } from "./categories";
import { classifyReceipt } from "./classify-receipt";

const rules: CategoryRule[] = [
  { pattern: "corner shop", category: "GROCERIES", target: "MERCHANT", priority: 100 },
  { pattern: "shampoo", category: "HEALTH", target: "ITEM", priority: 100 },
];

describe("classifying a receipt", () => {
  it("fills in a category nobody chose", () => {
    expect(
      classifyReceipt({ merchantName: "The Corner Shop", category: "OTHER" }, rules).category,
    ).toBe("GROCERIES");
  });

  it("never overwrites a category a person chose", () => {
    // The one rule that makes the feature safe: a deliberate choice is
    // not a suggestion for the classifier to improve on.
    expect(
      classifyReceipt({ merchantName: "The Corner Shop", category: "TRAVEL" }, rules).category,
    ).toBe("TRAVEL");
  });

  it("leaves OTHER alone when no rule has an opinion", () => {
    expect(
      classifyReceipt({ merchantName: "Zzyzx Holdings", category: "OTHER" }, rules).category,
    ).toBe("OTHER");
  });

  it("classifies items independently of the receipt", () => {
    const result = classifyReceipt(
      {
        merchantName: "The Corner Shop",
        category: "OTHER",
        items: [{ name: "Shampoo" }, { name: "Bread" }],
      },
      rules,
    );
    expect(result.category).toBe("GROCERIES");
    expect(result.items).toEqual(["HEALTH", "GROCERIES"]);
  });

  it("falls an unrecognised item back to its receipt, not to OTHER", () => {
    // Splitting one purchase across two categories for a line nobody has
    // a rule for would make the tax summary wrong in a way that looks
    // like data rather than like a bug.
    const result = classifyReceipt(
      { merchantName: "The Corner Shop", category: "OTHER", items: [{ name: "Mystery thing" }] },
      rules,
    );
    expect(result.items).toEqual(["GROCERIES"]);
  });

  it("keeps an item category that was set explicitly", () => {
    const result = classifyReceipt(
      {
        merchantName: "The Corner Shop",
        category: "OTHER",
        items: [{ name: "Shampoo", category: "SHOPPING" }],
      },
      rules,
    );
    expect(result.items).toEqual(["SHOPPING"]);
  });

  it("returns one item category per item, in order", () => {
    // The create path zips these against `data.items` by index, so a
    // length or order mismatch would silently mis-file line items.
    const items = [{ name: "a" }, { name: "Shampoo" }, { name: "c" }];
    const result = classifyReceipt({ merchantName: "x", category: "OTHER", items }, rules);
    expect(result.items).toHaveLength(items.length);
    expect(result.items[1]).toBe("HEALTH");
  });
});
