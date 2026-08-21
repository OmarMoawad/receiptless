import { taxSummary } from "./tax-summary";

/**
 * Session 6. The tax summary as CSV.
 *
 * Not streamed, unlike the receipt exports: this is one row per category,
 * so at most ten rows plus a total. Streaming it would be ceremony around
 * a few hundred bytes, and the aggregation has to complete before the
 * first row is known anyway.
 */
function csvCell(value: string | number): string {
  // Same spreadsheet-injection guard as receipt-export.ts. A merchant
  // name never reaches this file, but a category name is still data going
  // into a spreadsheet, and the rule is cheaper to apply than to reason
  // about each time.
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export async function taxSummaryCsv(ownerId: string, year: number): Promise<string> {
  const summary = await taxSummary(ownerId, year);

  const rows = [
    ["category", "receipt_count", "receipt_total_minor", "item_count", "item_total_minor", "currency"],
    ...summary.lines.map((line) => [
      line.category,
      line.receiptCount,
      line.totalMinor,
      line.itemCount,
      line.itemTotalMinor,
      summary.currency ?? "",
    ]),
    ["TOTAL", summary.receiptCount, summary.totalMinor, "", "", summary.currency ?? ""],
  ];

  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

  /**
   * The mixed-currency warning travels with the file, not just the page.
   * A summary that silently added dollars to pounds would be a confident
   * wrong number in someone's tax return — and the file is the artefact
   * that outlives the page it was downloaded from.
   */
  const warning =
    summary.mixedCurrencies.length > 0
      ? `\r\n\r\n${csvCell(
          `WARNING: this year contains receipts in ${summary.mixedCurrencies.join(", ")}. Totals are NOT converted — historical FX is Phase 2 session 7.`,
        )}`
      : "";

  return `﻿${body}\r\n${warning}`;
}
