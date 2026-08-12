import { describe, expect, it } from "vitest";
import { parseReceiptText } from "./receipt-ocr-parser";

describe("parseReceiptText", () => {
  it("extracts merchant, total, and items from a plain US-style receipt", () => {
    const text = `
      WHOLE FOODS MARKET
      123 Main St
      Organic Bananas         2.99
      Almond Milk             4.49
      Sourdough Bread         5.25
      Subtotal                12.73
      Tax                      1.02
      Total                   13.75
      CARD ****1234
      Thank you
    `
      .split("\n")
      .map((l) => l.trim())
      .join("\n");

    const result = parseReceiptText(text);
    expect(result.merchant).toBe("WHOLE FOODS MARKET");
    expect(result.totalMinor).toBe(1375);
    expect(result.items).toEqual([
      { name: "Organic Bananas", priceMinor: 299 },
      { name: "Almond Milk", priceMinor: 449 },
      { name: "Sourdough Bread", priceMinor: 525 },
    ]);
  });

  it("detects USD from a $ symbol and stops the total from also being read as a line item", () => {
    const text = [
      "Target",
      "Store #1234",
      "Paper Towels            $8.99",
      "Trash Bags              $12.49",
      "SUBTOTAL                $21.48",
      "TAX                      $1.72",
      "TOTAL                   $23.20",
      "VISA ENDING 4321",
    ].join("\n");

    const result = parseReceiptText(text);
    expect(result.merchant).toBe("Target");
    expect(result.currency).toBe("USD");
    expect(result.totalMinor).toBe(2320);
    expect(result.items).toEqual([
      { name: "Paper Towels", priceMinor: 899 },
      { name: "Trash Bags", priceMinor: 1249 },
    ]);
    expect(result.items.some((i) => /total|tax/i.test(i.name))).toBe(false);
  });

  it("handles European comma-decimal amounts and a € currency symbol", () => {
    const text = ["Cafe Central", "Espresso                €2,50", "Croissant                €3,20", "Total                    €5,70"].join(
      "\n",
    );

    const result = parseReceiptText(text);
    expect(result.currency).toBe("EUR");
    expect(result.totalMinor).toBe(570);
    expect(result.items).toEqual([
      { name: "Espresso", priceMinor: 250 },
      { name: "Croissant", priceMinor: 320 },
    ]);
  });

  it("prefers the grand total over a subtotal line", () => {
    const text = ["Shop", "Item A                  1.00", "Subtotal Total Due       1.00", "Total                    2.00"].join("\n");
    const result = parseReceiptText(text);
    expect(result.totalMinor).toBe(200);
  });

  it("returns nulls and no items for unparseable or empty text", () => {
    const result = parseReceiptText("   \n   \n  ");
    expect(result).toEqual({ merchant: null, totalMinor: null, currency: null, items: [] });
  });

  it("returns nulls for text with no amount-looking lines at all", () => {
    const result = parseReceiptText("Just some\nplain lines\nwith no prices");
    expect(result.totalMinor).toBeNull();
    expect(result.items).toEqual([]);
  });
});
