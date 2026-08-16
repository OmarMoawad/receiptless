#!/usr/bin/env node
/**
 * Session 2b follow-up — find receipts that may carry a **wrong but
 * plausible** total, written by the amount-parsing bug fixed in this
 * session.
 *
 * The bug: `AMOUNT_AT_END` could match a *suffix* of a longer digit run,
 * so a line reading `Total: 88123456789.00` was parsed as `789.00`. The
 * result is a receipt that looks entirely normal — a believable merchant,
 * a believable amount, nothing out of range — and is simply wrong.
 *
 * That is why `repair-legacy-receipts.mjs` cannot help here. It finds
 * receipts that are *obviously* broken (a zero total, a date as the
 * merchant name). A wrong-but-plausible total looks exactly like a right
 * one, so the only way to find these is to go back to the original
 * message and re-read the number.
 *
 * This script does that, for the receipts where the message was kept
 * (`Receipt.rawPayload`). It is **read-only** — it changes nothing, ever,
 * and has no --apply. Deciding what a receipt should say is a judgement
 * about someone's money, not something a script should guess.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/audit-suspect-totals.mjs
 *   DATABASE_URL=... node scripts/audit-suspect-totals.mjs --all   # include weak matches
 */
import { Client } from "pg";

const includeWeak = process.argv.includes("--all");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

/**
 * A number with **four or more** un-grouped integer digits and a two-digit
 * fraction — `88123456789.00`, `1234567.89`. Four is the threshold
 * because the old pattern matched at most three integer digits before a
 * separator, so anything longer is where it could start mid-run.
 *
 * Properly grouped amounts (`1,234.56`) are not flagged: the old pattern
 * handled those correctly, and flagging them would bury the real hits.
 */
const LONG_NUMBER_AT_LINE_END = /(\d{4,})[.,](\d{2})[\s*]{0,3}[A-Za-z0-9%]{0,4}\s*$/;

/** What the old parser would have produced from that line. */
function buggyMinorFor(integerDigits, fractionDigits) {
  const lastThree = integerDigits.slice(-3);
  return Number(lastThree) * 100 + Number(fractionDigits);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(`
    SELECT r.id, r."ownerId", r."totalMinor", r.currency, r."purchasedAt", r."rawPayload", m.name AS merchant
    FROM "Receipt" r
    JOIN "Merchant" m ON m.id = r."merchantId"
    WHERE r.source = 'EMAIL' AND r."rawPayload" IS NOT NULL
    ORDER BY r."createdAt"
  `);

  const confirmed = [];
  const weak = [];

  for (const row of rows) {
    for (const line of String(row.rawPayload).split(/\r?\n/)) {
      const match = line.match(LONG_NUMBER_AT_LINE_END);
      if (!match) continue;

      const [, integerDigits, fractionDigits] = match;
      const wouldHaveParsed = buggyMinorFor(integerDigits, fractionDigits);
      const trueMinor = Number(`${integerDigits}${fractionDigits}`);

      // The stored total matching what the *bug* produces, on a line the
      // bug could have produced it from, is as close to proof as this can
      // get without the original mail in front of a human.
      if (wouldHaveParsed === row.totalMinor) {
        confirmed.push({ row, line: line.trim(), trueMinor });
      } else {
        weak.push({ row, line: line.trim() });
      }
    }
  }

  const money = (minor, currency) => `${(minor / 100).toFixed(2)} ${currency}`;

  if (confirmed.length === 0 && weak.length === 0) {
    console.log(`Checked ${rows.length} email receipts with a retained message. Nothing matches the parsing bug.`);
    console.log("Note: receipts whose message was not retained cannot be checked this way at all.");
    process.exit(0);
  }

  if (confirmed.length > 0) {
    console.log(`\n${confirmed.length} receipt(s) whose stored total is exactly what the bug would produce:\n`);
    for (const { row, line, trueMinor } of confirmed) {
      console.log(`  ${row.id}  owner=${row.ownerId}  ${row.merchant}`);
      console.log(`    stored:     ${money(row.totalMinor, row.currency)}`);
      console.log(`    source line: ${JSON.stringify(line)}`);
      console.log(`    that line's actual number: ${money(trueMinor, row.currency)}`);
      console.log(
        `    -> Almost certainly wrong. Read the original mail before changing anything: the real total may be` +
          ` on a different line entirely, and this number may be an order reference rather than money.\n`,
      );
    }
  }

  if (weak.length > 0) {
    if (includeWeak) {
      console.log(`\n${weak.length} receipt(s) with a long number on a line, where the total does not match the bug:\n`);
      for (const { row, line } of weak) {
        console.log(`  ${row.id}  ${row.merchant}  stored ${money(row.totalMinor, row.currency)}  line: ${JSON.stringify(line)}`);
      }
    } else {
      console.log(`\n${weak.length} receipt(s) contain a long number but their total does not match the bug's output.`);
      console.log("Those are probably fine. Re-run with --all to list them.");
    }
  }

  console.log("\nThis script changes nothing. What a receipt should say is your call, not a script's.");
  console.log("Receipts whose original message was not retained cannot be checked this way at all.");
} finally {
  await client.end();
}
