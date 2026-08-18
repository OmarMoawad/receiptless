#!/usr/bin/env node
/**
 * Session 2b — external review finding #1's second half: **perform and
 * document a real restore.**
 *
 * The review's objection was not that backups were missing. It was that
 * nothing had ever been restored, so the ability to recover was an
 * assumption. An untested backup is a belief about a file.
 *
 * This restores a dump into a **scratch database**, then checks the thing
 * a restore is actually for: that the tables are there and that they
 * contain the rows they contained. It refuses to touch the source
 * database, and it drops the scratch database afterwards unless asked to
 * keep it.
 *
 * Usage:
 *   node scripts/verify-backup-restore.mjs <dump-file> \
 *     --docker receiptless-db-1 \
 *     --admin-url postgresql://receiptless:receiptless@localhost:5432/postgres \
 *     --source-url postgresql://receiptless:receiptless@localhost:5432/receiptless
 *
 * As with backup-database.mjs, in --docker mode the URLs are resolved
 * inside the container.
 */
import { spawn } from "node:child_process";
import { basename } from "node:path";

const args = process.argv.slice(2);
const dumpFile = args[0];
const container = valueOf("--docker");
const adminUrl = valueOf("--admin-url") ?? process.env.ADMIN_DATABASE_URL;
const sourceUrl = valueOf("--source-url") ?? process.env.DATABASE_URL;
const keep = args.includes("--keep");

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (!dumpFile || dumpFile.startsWith("--") || !adminUrl || !sourceUrl) {
  console.error("usage: node scripts/verify-backup-restore.mjs <dump-file> --admin-url <url> --source-url <url> [--docker <container>] [--keep]");
  process.exit(2);
}

const scratchDb = `receiptless_restore_check_${Date.now()}`;

/** Runs a command, optionally inside the container, and returns its stdout. */
function run(command, commandArgs, { stdin } = {}) {
  const spawnArgs = container ? ["exec", stdin ? "-i" : "-i", container, command, ...commandArgs] : commandArgs;
  const child = spawn(container ? "docker" : command, spawnArgs, {
    stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
  });

  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  if (stdin) stdin.pipe(child.stdin);

  return new Promise((resolveRun, rejectRun) => {
    child.on("close", (code) => (code === 0 ? resolveRun(out) : rejectRun(new Error(`${command} exited ${code}: ${err}`))));
  });
}

function psql(url, sql) {
  return run("psql", ["--no-psqlrc", "--tuples-only", "--no-align", url, "-c", sql]);
}

/**
 * The tables a restore has to bring back for this app to be the same app.
 * Deliberately named rather than discovered: a check that compares
 * "whatever is in the dump" against "whatever is in the dump" proves
 * nothing.
 */
const TABLES = ["User", "Session", "Receipt", "ReceiptItem", "Merchant", "InboundEmailDelivery", "EmailConnection"];

async function rowCounts(url) {
  const counts = {};
  for (const table of TABLES) {
    counts[table] = Number((await psql(url, `SELECT count(*) FROM "${table}"`)).trim());
  }
  return counts;
}

console.log(`Rehearsing a restore of ${basename(dumpFile)} into ${scratchDb}\n`);

let created = false;
try {
  const before = await rowCounts(sourceUrl);
  console.log("Source row counts:");
  for (const [table, count] of Object.entries(before)) console.log(`  ${table.padEnd(22)} ${count}`);

  await psql(adminUrl, `CREATE DATABASE "${scratchDb}"`);
  created = true;

  const restoreUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, `/${scratchDb}$1`);
  const { createReadStream } = await import("node:fs");

  // pg_restore reads the dump on stdin, so the file never has to exist
  // inside the container.
  await run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", restoreUrl], {
    stdin: createReadStream(dumpFile),
  });

  const after = await rowCounts(restoreUrl);
  console.log("\nRestored row counts:");
  for (const [table, count] of Object.entries(after)) console.log(`  ${table.padEnd(22)} ${count}`);

  const mismatched = TABLES.filter((table) => before[table] !== after[table]);
  if (mismatched.length > 0) {
    console.error(`\nFAIL — these tables did not come back with the same number of rows: ${mismatched.join(", ")}`);
    console.error("(A mismatch is expected if the source changed while the dump was being taken — re-run against a quiet database before concluding the backup is bad.)");
    process.exitCode = 1;
  } else {
    console.log(`\nPASS — ${TABLES.length} tables restored with matching row counts.`);
    console.log("Record the date and the outcome in DEPLOYMENT.md §6. A rehearsal nobody wrote down is a rehearsal nobody can rely on.");
  }
} finally {
  if (created && !keep) {
    await psql(adminUrl, `DROP DATABASE "${scratchDb}"`).catch((error) => {
      console.error(`Could not drop the scratch database ${scratchDb}: ${error.message}`);
    });
  } else if (created) {
    console.log(`\nScratch database kept: ${scratchDb}`);
  }
}
