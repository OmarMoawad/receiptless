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
   * The warning travels with the file, not just the page. The file is the
   * artefact that outlives the page it was downloaded from, and whoever
   * reads it next April has no other way to know what it left out.
   *
   * Session 7 narrowed what it has to say. Mixed currencies *are*
   * converted now, at the rate stored on each receipt at ingest. What
   * still must be declared is the remainder: receipts with no rate on
   * file are excluded from every total above, so the file names them and
   * their untouched amounts rather than presenting a total that quietly
   * omits them.
   */
  const warning =
    summary.unconverted.length > 0
      ? `\r\n\r\n${csvCell(
          `WARNING: ${summary.unconverted
            .map((line) => `${line.receiptCount} receipt(s) in ${line.currency}`)
            .join(", ")} are EXCLUDED from the totals above — no exchange rate is on file for the day they were bought. Totals are in ${summary.currency}, converted at the rate stored on each receipt at purchase time, never at today's rate.`,
        )}`
      : "";

  return `﻿${body}\r\n${warning}`;
}
