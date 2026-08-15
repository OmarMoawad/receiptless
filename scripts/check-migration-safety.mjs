#!/usr/bin/env node
/**
 * Session 10 Part B — enforce the property the rollback procedure depends
 * on.
 *
 * DEPLOYMENT.md §7 says rolling back a deployment is safe *because*
 * migrations are additive: promoting an older build does not roll back a
 * migration, so the previous release's code must still run against the
 * current schema. That is the whole basis for "promote the last good
 * deployment" being a recovery procedure rather than a second outage.
 *
 * Nothing enforced it. Writing the rule in a document and hoping is the
 * same class of unverified claim these two sessions exist to remove — and
 * the repo already contains a counterexample (see ALLOWLIST below), which
 * is how this check came to be written.
 *
 * So: fail the build on migration SQL that would break the previous
 * release's code, at PR time, when fixing it is cheap.
 *
 * Usage:
 *   node scripts/check-migration-safety.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/migrations");

/**
 * Statements that break code compiled against the *previous* schema.
 *
 * `ADD COLUMN ... NOT NULL` without a default is included deliberately:
 * the new column is invisible to old code, so every insert the old release
 * performs omits it and fails. With a default it is fine, which is why the
 * pattern checks for the absence of one.
 */
const DESTRUCTIVE_PATTERNS = [
  { name: "DROP COLUMN", pattern: /ALTER\s+TABLE[\s\S]{0,200}?DROP\s+COLUMN/i },
  { name: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { name: "RENAME COLUMN", pattern: /\bRENAME\s+COLUMN\b/i },
  { name: "RENAME TO (table)", pattern: /ALTER\s+TABLE[\s\S]{0,200}?\bRENAME\s+TO\b/i },
  { name: "DROP NOT NULL / SET NOT NULL on existing column", pattern: /ALTER\s+COLUMN[\s\S]{0,80}?SET\s+NOT\s+NULL/i },
  { name: "ADD COLUMN NOT NULL without DEFAULT", pattern: /ADD\s+COLUMN\s+"?[\w]+"?\s+[\w()]+\s+NOT\s+NULL(?![\s\S]{0,40}?DEFAULT)/i },
  { name: "DELETE FROM", pattern: /\bDELETE\s+FROM\b/i },
  { name: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
];

/**
 * Migrations that are destructive but already deployed and understood.
 *
 * An allowlist rather than a blanket "ignore old migrations", because the
 * point is that each exception was looked at once and reasoned about. A
 * new entry here should be an argued decision, not a way to silence the
 * check.
 */
const ALLOWLIST = new Map([
  [
    "20260811201429_add_receipt_image_key",
    "Session 4, pre-deployment. Drops Receipt.imageUrl and adds imageKey in " +
      "one migration — exactly the pattern this check exists to prevent, and " +
      "the reason it was written. Safe only because it predates any " +
      "deployment: no released code has ever run against the post-drop " +
      "schema, so there is no rollback target it could break. Not a " +
      "precedent.",
  ],
]);

function migrationDirectories() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Strips SQL comments so Prisma's own generated "Warnings" block — which
// spells out the destructive change in prose — cannot trip a pattern.
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function main() {
  const problems = [];
  const allowed = [];
  const directories = migrationDirectories();

  for (const name of directories) {
    const file = join(MIGRATIONS_DIR, name, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = stripComments(readFileSync(file, "utf8"));

    const hits = DESTRUCTIVE_PATTERNS.filter(({ pattern }) => pattern.test(sql)).map(({ name: label }) => label);
    if (hits.length === 0) continue;

    if (ALLOWLIST.has(name)) {
      allowed.push({ name, hits, reason: ALLOWLIST.get(name) });
    } else {
      problems.push({ name, hits });
    }
  }

  console.log(`Checked ${directories.length} migrations for rollback safety.\n`);

  for (const { name, hits } of allowed) {
    console.log(`  ALLOWED  ${name}`);
    console.log(`           ${hits.join(", ")}`);
    console.log(`           ${ALLOWLIST.get(name).split(". ")[0]}.\n`);
  }

  if (problems.length === 0) {
    console.log(`No unreviewed destructive migrations. Rolling back to the previous release is safe with respect to schema.`);
    return;
  }

  console.error("Destructive migration(s) found — the previous release's code would break against this schema:\n");
  for (const { name, hits } of problems) {
    console.error(`  ${name}`);
    for (const hit of hits) console.error(`    - ${hit}`);
  }
  console.error(
    `\nPromoting an older deployment does NOT roll back a migration (DEPLOYMENT.md §7).\n` +
      `Split this across two releases: ship the additive half first, deploy code that\n` +
      `works with both shapes, then remove the old column in a later release.\n\n` +
      `If it is genuinely safe — for example it predates any deployment — add it to\n` +
      `ALLOWLIST in this script with the reasoning, so the exception is recorded\n` +
      `rather than assumed.`,
  );
  process.exit(1);
}

main();
