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
import { requireDatabaseUrl } from "./lib/database-url.mjs";

const apply = process.argv.includes("--apply");
const ownerFlag = process.argv.indexOf("--owner");
const owner = ownerFlag === -1 ? null : process.argv[ownerFlag + 1];

/**
 * A merchant name that is really a date. The first scan produced these
 * when the pos-slip adapter took a printed date line as the merchant
 * heading — "12/08/2026", "12 August 2026", "2026-08-12".
 */
const DATE_LIKE_MERCHANT = String.raw`^\s*(\d{1,4}[-/]\d{1,2}[-/]\d{1,4}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})\s*$`;

/**
 * **`recoverable` is the reason this query is not just a WHERE clause.**
 *
 * Run against real production data on 2026-08-18, this script's original
 * form would have deleted four receipts — and one of them was a genuine
 * $22.80 invoice whose total the parser had failed to read because the
 * whole receipt arrived on a single unwrapped line. Deleting a real
 * receipt to tidy up a parser's mistake is a strictly worse outcome than
 * the mistake.
 *
 * So a row whose retained message still contains a money-shaped number is
 * classified `recoverable` and is **never** deleted, whatever flags are
 * passed. A row with no money anywhere in it was not a receipt — an order
 * confirmation, a dispatch note — and deleting it loses nothing.
 */
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
         END AS reason,
         (r."rawPayload" IS NOT NULL AND r."rawPayload" ~ '[0-9]+[.,][0-9]{2}') AS recoverable
  FROM "Receipt" r
  JOIN "Merchant" m ON m.id = r."merchantId"
  LEFT JOIN "InboundEmailDelivery" d ON d."receiptId" = r.id
  WHERE r.source = 'EMAIL'
    AND (r."totalMinor" = 0 OR m.name ~* $1)
    AND ($2::text IS NULL OR r."ownerId" = $2)
  ORDER BY r."createdAt"
`;

const client = new Client({ connectionString: requireDatabaseUrl() });
await client.connect();

try {
  /**
   * This script writes `status` and `failureReason` on
   * InboundEmailDelivery, which the session-2b migration adds. Pointed at
   * a database still on the previous release it would abort mid
   * transaction with a bare "column does not exist" — which is exactly
   * what happened on 2026-08-18 when the equivalent SQL was run by hand
   * against production before the migration had landed.
   *
   * Checked up front so the answer is a sentence rather than an aborted
   * transaction the operator has to reason about and roll back.
   */
  const { rows: schema } = await client.query(
    `SELECT count(*)::int AS present FROM information_schema.columns
     WHERE table_name = 'InboundEmailDelivery' AND column_name IN ('status', 'failureReason')`,
  );
  if (schema[0].present < 2) {
    console.error("This database has not run the session-2b migration yet.");
    console.error("InboundEmailDelivery is missing `status` and/or `failureReason`, which this script writes.");
    console.error("Deploy the migration first (npm run db:migrate), then re-run. Nothing was changed.");
    process.exit(4);
  }

  const { rows } = await client.query(SELECT_SUSPECT_RECEIPTS, [DATE_LIKE_MERCHANT, owner]);

  if (rows.length === 0) {
    console.log("No legacy zero-total or date-as-merchant email receipts found. Nothing to repair.");
    process.exit(0);
  }

  const recoverable = rows.filter((row) => row.recoverable);
  const deletable = rows.filter((row) => !row.recoverable);

  console.log(`Found ${rows.length} suspect receipt(s).\n`);

  if (recoverable.length > 0) {
    console.log(`${recoverable.length} of them still contain an amount and will NOT be deleted:\n`);
    for (const row of recoverable) {
      console.log(
        `  KEEP  ${row.id}  merchant=${JSON.stringify(row.merchant)}  stored=${row.totalMinor}  (${row.reason})`,
      );
    }
    console.log(
      "\n  These are real receipts the parser could not read, not junk. Deleting them\n" +
        "  would lose a purchase record to tidy up a parsing mistake. Fix the total\n" +
        "  instead — by hand, or once the parser can read that shape.\n",
    );
  }

  if (deletable.length > 0) {
    console.log(`${deletable.length} contain no amount at all and are safe to remove:\n`);
    for (const row of deletable) {
      console.log(
        `  DELETE  ${row.id}  merchant=${JSON.stringify(row.merchant)}  stored=${row.totalMinor}  (${row.reason})`,
      );
    }
  }

  if (deletable.length === 0) {
    console.log("\nNothing is safe to delete automatically. Exiting without changes.");
    process.exit(0);
  }

  if (!apply) {
    console.log("\nDry run — nothing changed. Re-run with --apply to delete these receipts.");
    console.log("Each deletion leaves its delivery row marked 'unparsed', so the owner sees the message was skipped.");
    process.exit(0);
  }

  // One transaction: a partial repair that deletes receipts but leaves
  // their deliveries claiming success would be worse than not running.
  await client.query("BEGIN");

  // Only ever the rows with no amount in them. See `recoverable` above.
  const ids = deletable.map((row) => row.id);

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

  /**
   * 42501 is Postgres's insufficient_privilege. It is the *expected*
   * outcome of running --apply with the read-only credential this
   * script's own instructions recommend for the dry run, so it deserves
   * a sentence rather than a stack trace. Nothing was changed: the
   * ROLLBACK above is what guarantees that, not the permission error.
   */
  if (error?.code === "42501") {
    console.error("\nRefused: this database role may read but not write. Nothing was changed.");
    console.error("That is the read-only audit credential doing its job.");
    console.error("To apply the repair, re-run with a role that has UPDATE and DELETE on Receipt,");
    console.error("ReceiptItem and InboundEmailDelivery — and read the dry-run output first.");
    process.exit(3);
  }

  throw error;
} finally {
  await client.end();
}
