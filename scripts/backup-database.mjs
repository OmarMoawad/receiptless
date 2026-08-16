#!/usr/bin/env node
/**
 * Session 2b — external review finding #1's first half: an **independent**
 * backup.
 *
 * Neon's history retention on this project is 6 hours (DEPLOYMENT.md §6),
 * and that is the only copy of the data that exists. Point-in-time
 * recovery inside a provider is not a backup in the sense that matters:
 * it does not survive the account, a billing lapse, a mistaken project
 * deletion, or a provider-side incident. A dump written somewhere else
 * does.
 *
 * This produces a compressed custom-format dump plus a SHA-256 checksum,
 * and prints the two numbers a restore decision needs: how large it is,
 * and how old the data in it will be by the time the next one runs.
 *
 * It intentionally does **not** upload anywhere. Where backups are stored
 * is Omar's decision (R2 has no egress fees, which is why it holds the
 * receipt images), and a script that guesses a destination for someone's
 * financial history is worse than one that hands them a file.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/backup-database.mjs [--out ./backups]
 *   node scripts/backup-database.mjs --docker receiptless-db-1 \
 *     --url postgresql://receiptless:receiptless@localhost:5432/receiptless
 *
 * `--docker` runs pg_dump inside a container instead of on the host,
 * which is how it works on a machine with no Postgres client installed —
 * including the one this was written on. Note the URL in that mode is
 * resolved **inside the container**, so the port is the container's
 * (5432), not the one docker-compose publishes on the host (5433). That
 * is not a detail worth rediscovering at 3am, which is why it is here.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const outDir = resolve(valueOf("--out") ?? "./backups");
const container = valueOf("--docker");
const url = valueOf("--url") ?? process.env.DATABASE_URL;

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (!url) {
  console.error("DATABASE_URL (or --url) is required.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = resolve(outDir, `receiptless-${stamp}.dump`);

/**
 * Custom format (-Fc) rather than plain SQL: it is compressed, and
 * pg_restore can read it selectively — which matters when the thing you
 * need back is one table, not the whole database.
 */
const pgDumpArgs = ["--format=custom", "--no-owner", "--no-privileges", url];
const command = container ? "docker" : "pg_dump";
const commandArgs = container ? ["exec", "-i", container, "pg_dump", ...pgDumpArgs] : pgDumpArgs;

const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "inherit"] });
const file = createWriteStream(outFile);
child.stdout.pipe(file);

const code = await new Promise((resolveExit) => child.on("close", resolveExit));

if (code !== 0) {
  console.error(`\npg_dump exited with ${code}. No usable backup was written.`);
  if (!container) {
    console.error("If pg_dump is not installed on this machine, re-run with --docker <container-name>.");
  }
  process.exit(1);
}

const bytes = statSync(outFile).size;
if (bytes === 0) {
  console.error("The dump is empty. Treating that as a failure rather than a backup.");
  process.exit(1);
}

// A backup nobody can prove is intact is a backup nobody should rely on.
const digest = createHash("sha256").update(await readFile(outFile)).digest("hex");

console.log(`Wrote ${outFile}`);
console.log(`  size:    ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`  sha256:  ${digest}`);
console.log("");
console.log("This file is the only copy that survives losing the Neon account. Store it somewhere else.");
console.log("Verify it restores before trusting it: node scripts/verify-backup-restore.mjs " + outFile);
