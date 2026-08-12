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

  it("falls back to an 'amount due' line when no line says 'total' at all", () => {
    const text = ["Shop", "Widget                  9.99", "Amount Due               9.99"].join("\n");
    const result = parseReceiptText(text);
    expect(result.totalMinor).toBe(999);
  });

  // Regression test for a real click-through bug (2026-08-12, found by
  // Omar): a genuine, noisy Tesseract.js scan of a real Kohl's receipt.
  // guessMerchant previously had no quality filter beyond "not an amount,
  // not pure digits" — the first line here, a stray OCR-misread border
  // character, passed both checks and was returned as the merchant
  // verbatim (": E"). Also exercises the AMOUNT_AT_END relaxation: the
  // "MEN'S GIFTS" line has a trailing tax-category code ("T1") after the
  // price, which the original strict end-of-line match silently dropped
  // (items came back empty). Not every noisy line recovers — the SEAS
  // SPORTS TOY line has an extra stray OCR glyph after its own "T1" that
  // still breaks the match, and the true grand total is genuinely
  // ambiguous in this scan (no line unambiguously pairs "total"/"amount
  // due" with the actual charged amount) — both accepted as honest
  // limitations of heuristic parsing, not bugs to chase further today.
  it("doesn't return OCR noise as the merchant on a real, messy receipt scan", () => {
    const text = [
      ": E",
      "3 Lisbon E",
      "i Lisbon, CT 63510 i",
      "4 (860) 376-7770 Rs",
      "2 ho",
      "5 09-18-14 2:28P 0471/0027/0401/0 1339%XXX 2",
      "ID# 999-9081-8585-7148-9528-7295-9855 je",
      "8 13",
      "| MEN'S GIFTS 017149538349 G 4.00 T1",
      "g ItemPrice 40.00 YouSave 36.00 b",
      "{| SEAS SPORTS TOY 083568050007 * 6.49 T1 ©",
      ": ItemPrice 12.99 YouSave 6.50 i;",
      "x SUBTOTAL 10.49 =",
      "5 KOHL'S CASH 169770002499411 10.00- fe",
      "A **REMAINING BALANCE 0.00 ¥",
      "i T1= 0.49 @ 6.35% TAX 0.03 5",
    ].join("\n");

    const result = parseReceiptText(text);
    expect(result.merchant).not.toBe(": E");
    expect(result.merchant).toMatch(/[A-Za-z]{2,}/);
    expect(result.items.map((i) => i.priceMinor)).toContain(400); // MEN'S GIFTS, "... 4.00 T1"
  });

  it("finds the total when OCR misreads the word 'Total' itself (e.g. 'Jotal')", () => {
    const text = ["Shop", "Widget                  9.99", "Jotal                   9.99"].join("\n");
    expect(parseReceiptText(text).totalMinor).toBe(999);
  });

  it("doesn't fuzzy-match unrelated short words as 'total'", () => {
    const text = ["Shop", "Cash                     9.99"].join("\n");
    expect(parseReceiptText(text).totalMinor).toBeNull();
  });

  it("repairs a total where OCR dropped the decimal point (a currency symbol confirms it's an amount)", () => {
    const text = ["Shop", "Widget                  9.99", "Total                   $23 75"].join("\n");
    expect(parseReceiptText(text).totalMinor).toBe(2375);
  });

  // Regression test for a second real click-through find (2026-08-12,
  // found by Omar): a real, noisy scan of a Brioche Doré receipt. Two
  // compounding OCR failures on the same physical total line ("Tote. $23
  // 75"): the word "Total" itself got misread ("Tote.", handled by the
  // fuzzy-match fallback above) *and* the decimal point was dropped
  // entirely (handled by the space-repair fallback above) — without both
  // fixes together, an earlier, unrelated line ("Jotal 1.23 $2.00", itself
  // an OCR-garbled fragment, not the real subtotal/total) would win
  // instead and silently produce a plausible-looking but wrong total.
  it("recovers the correct total from a real receipt with both a garbled 'Total' word and a dropped decimal point", () => {
    const text = [
      "Brioche",
      "doree",
      "Customer Copy",
      "Latte $7.00",
      "Crojssane 2 $7.00",
      "Jotal 1.23 $2.00",
      "Ix 1.23 | 823. 45",
      "Subtora; / pe",
      "Tote. $23 75",
      "Rounding Adjustmens / soo",
    ].join("\n");

    const result = parseReceiptText(text);
    expect(result.merchant).toBe("Brioche");
    expect(result.totalMinor).toBe(2375);
  });

  // Regression test for a real click-through bug (2026-08-12, found by
  // Omar, against the *same* Kohl's receipt as the merchant-noise test
  // above — but this time read by Surya, whose real-world accuracy on
  // this receipt was dramatically better than Tesseract's: it recognized
  // "TOTAL    $0.52" cleanly. The remaining bug was in the parser, not
  // the OCR: this receipt separately prints "TOTAL SAVED: $52.50" (a
  // promotional discount summary) *after* the real total line, and
  // TOTAL_LINE's bare /\btotal\b/i match doesn't distinguish the two —
  // the bottom-up scan in guessTotalMinor found "TOTAL SAVED" first and
  // returned $52.50 instead of the actual $0.52 charged.
  it("doesn't mistake a 'Total Saved' discount-summary line for the real total", () => {
    const text = [
      "Lisbon",
      "Lisbon, CT 63510",
      "MEN'S CAFTS    017149538349 G    4.00 T1",
      "SUBTOTAL    10.49",
      "** REMAINING BALANCE    0.00",
      "TOTAL    $0.52",
      "CASH    0.52",
      "TOTAL SAVED: $52.50",
      "THANK YOU FOR SHOPPING AT KOHL'S",
    ].join("\n");

    expect(parseReceiptText(text).totalMinor).toBe(52);
  });
});
