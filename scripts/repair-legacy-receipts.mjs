#!/usr/bin/env node
/**
 * Session 2b — external review finding #6's other half: the rows that are
 * already there.
 *
 * The parser stopped importing unreadable mail as $0.00 receipts on
 * 2026-08-15, and session 2b made unreadable mail retryable rather than
 * invisible. Neither fixes the rows written *before* those changes: the
 * first real Gmail scan created receipts with a zero total, and receipts
 * whose merchant name is a date, and they are sitting in production now.
 *
 * This script finds them and, with --apply, removes them — turning each
 * one back into a visible "this message was not imported" entry the owner
 * can see, rather than a false record of a purchase that never happened
 * at that amount.
 *
 * **It is dry-run by default and it deletes rows with --apply.** It has
 * to be run by someone with production database access; there is no way
 * for it to be run from CI, and it should not be.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/repair-legacy-receipts.mjs            # report only
 *   DATABASE_URL=... node scripts/repair-legacy-receipts.mjs --apply    # delete
 *   DATABASE_URL=... node scripts/repair-legacy-receipts.mjs --apply --owner <userId>
 */
import { Client } from "pg";

const apply = process.argv.includes("--apply");
const ownerFlag = process.argv.indexOf("--owner");
const owner = ownerFlag === -1 ? null : process.argv[ownerFlag + 1];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

/**
 * A merchant name that is really a date. The first scan produced these
 * when the pos-slip adapter took a printed date line as the merchant
 * heading — "12/08/2026", "12 August 2026", "2026-08-12".
 */
const DATE_LIKE_MERCHANT = String.raw`^\s*(\d{1,4}[-/]\d{1,2}[-/]\d{1,4}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})\s*$`;

const SELECT_SUSPECT_RECEIPTS = `
  SELECT r.id,
         r."ownerId",
         r."totalMinor",
         r."purchasedAt",
         m.name AS merchant,
         d.id AS delivery_id,
         CASE
           WHEN r."totalMinor" = 0 THEN 'zero total'
           ELSE 'merchant name is a date'
         END AS reason
  FROM "Receipt" r
  JOIN "Merchant" m ON m.id = r."merchantId"
  LEFT JOIN "InboundEmailDelivery" d ON d."receiptId" = r.id
  WHERE r.source = 'EMAIL'
    AND (r."totalMinor" = 0 OR m.name ~* $1)
    AND ($2::text IS NULL OR r."ownerId" = $2)
  ORDER BY r."createdAt"
`;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(SELECT_SUSPECT_RECEIPTS, [DATE_LIKE_MERCHANT, owner]);

  if (rows.length === 0) {
    console.log("No legacy zero-total or date-as-merchant email receipts found. Nothing to repair.");
    process.exit(0);
  }

  console.log(`Found ${rows.length} suspect receipt(s):\n`);
  for (const row of rows) {
    console.log(
      `  ${row.id}  owner=${row.ownerId}  total=${row.totalMinor}  merchant=${JSON.stringify(row.merchant)}  (${row.reason})`,
    );
  }

  if (!apply) {
    console.log("\nDry run — nothing changed. Re-run with --apply to delete these receipts.");
    console.log("Each deletion leaves its delivery row marked 'unparsed', so the owner sees the message was skipped.");
    process.exit(0);
  }

  // One transaction: a partial repair that deletes receipts but leaves
  // their deliveries claiming success would be worse than not running.
  await client.query("BEGIN");

  const ids = rows.map((row) => row.id);

  /**
   * The delivery keeps existing — it is what stops the next scan
   * re-importing the same message — but it stops pointing at a receipt
   * and starts saying, in the owner's review list, that the message was
   * not understood. It carries no retained body: nothing kept the
   * message at the time, so it cannot be reprocessed automatically. That
   * is stated in the reason rather than left to be discovered.
   */
  const updated = await client.query(
    `UPDATE "InboundEmailDelivery"
     SET "receiptId" = NULL,
         "status" = 'unparsed',
         "failureReason" = 'imported before the parser refused unreadable mail; the original message was not retained, so it cannot be reprocessed automatically'
     WHERE "receiptId" = ANY($1)`,
    [ids],
  );

  const deletedItems = await client.query(`DELETE FROM "ReceiptItem" WHERE "receiptId" = ANY($1)`, [ids]);
  const deleted = await client.query(`DELETE FROM "Receipt" WHERE id = ANY($1)`, [ids]);

  await client.query("COMMIT");

  console.log(
    `\nDeleted ${deleted.rowCount} receipt(s) and ${deletedItems.rowCount} item(s); ` +
      `${updated.rowCount} delivery row(s) now show as not imported.`,
  );
  console.log("Merchant rows are left alone — a merchant with no receipts is harmless and may be shared.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
