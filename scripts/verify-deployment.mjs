#!/usr/bin/env node
/**
 * Session 10 Part B — check a real deployment against Session 10's exit
 * criteria, from outside, over HTTP.
 *
 * The session's brief was explicit that the criteria are "all of these,
 * not a subset", so this script checks them all and reports each one
 * rather than exiting on the first failure. A deploy that fails three
 * checks should tell you three things, not one per run.
 *
 * What it cannot check, and does not pretend to:
 *   - whether backups/PITR are actually retained (provider dashboard)
 *   - whether the log drain is delivering (Vercel/Sentry dashboard)
 *   - whether a real Gmail account completed consent (needs a human)
 * Those stay manual and are listed at the end as such, so "verified" here
 * never quietly means "verified except the hard parts".
 *
 * Usage:
 *   node scripts/verify-deployment.mjs https://receiptless.vercel.app
 */
const BASE = (process.argv[2] || process.env.DEPLOYMENT_URL || "").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS || 20_000);

if (!BASE) {
  console.error("usage: node scripts/verify-deployment.mjs <deployment-url>");
  process.exit(2);
}

const results = [];
const record = (name, ok, detail, manual = false) => results.push({ name, ok, detail, manual });

async function get(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual", signal: controller.signal, ...options });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  let payload;
  let status;
  try {
    const response = await get("/api/health");
    status = response.status;
    payload = JSON.parse(response.text);
  } catch (error) {
    record("Readiness endpoint reachable", false, `GET /api/health failed: ${error.message}`);
    return null;
  }

  record("Readiness endpoint reachable", true, `HTTP ${status}`);

  // The database check is the one that proves this ran against real
  // infrastructure rather than a build artifact.
  record(
    "Database reachable from the deployment",
    payload.database === "ok",
    `database: ${payload.database}`,
  );

  record(
    "No required configuration missing",
    Array.isArray(payload.missingConfig) && payload.missingConfig.length === 0,
    payload.missingConfig?.length ? `missing: ${payload.missingConfig.join(", ")}` : "missingConfig empty",
  );

  // The encryption-key gate, verified against the real environment — an
  // explicit exit criterion, and the one that would otherwise let real
  // refresh tokens be encrypted under a key committed to this repo.
  record(
    "Encryption key gate satisfied (no committed dev key in use)",
    Array.isArray(payload.insecureConfig) && payload.insecureConfig.length === 0,
    payload.insecureConfig?.length ? `insecure: ${payload.insecureConfig.join(", ")}` : "insecureConfig empty",
  );

  record(
    "Unauthenticated merchant endpoint disabled",
    payload.merchantApiEnabled === false,
    `merchantApiEnabled: ${payload.merchantApiEnabled}`,
  );

  record(
    "Error tracking active",
    payload.errorTrackingEnabled === true,
    `errorTrackingEnabled: ${payload.errorTrackingEnabled}`,
  );

  record("Readiness returns 200 overall", status === 200, `HTTP ${status}, status field: ${payload.status}`);

  // No values, only key names — this endpoint is unauthenticated.
  const leaked = ["postgres://", "postgresql://", "r2.cloudflarestorage", "sk-", "AKIA"].filter((needle) =>
    JSON.stringify(payload).toLowerCase().includes(needle.toLowerCase()),
  );
  record("Readiness leaks no configuration values", leaked.length === 0, leaked.length ? `found: ${leaked.join(", ")}` : "no values present");

  return payload;
}

/**
 * The merchant endpoint creates rows and claim tokens for anyone who can
 * reach it. `isMerchantApiEnabled` should make it a 404 in production;
 * this confirms the gate from the outside rather than trusting the flag
 * the health endpoint reports about itself.
 */
async function checkMerchantEndpointClosed() {
  try {
    const response = await get("/api/merchant/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchant: "verify-script", total: 1 }),
    });
    record(
      "Merchant endpoint returns 404 to the public internet",
      response.status === 404,
      `POST /api/merchant/receipts -> HTTP ${response.status}`,
    );
  } catch (error) {
    record("Merchant endpoint returns 404 to the public internet", false, error.message);
  }
}

/**
 * The OAuth entry point should respond without erroring.
 *
 * It is a **POST** — the flow is started by a form action, not a link, so
 * that beginning an OAuth connection is not something a cross-site GET can
 * trigger. A first draft of this script sent GET and read the resulting
 * 405 as a pass, which would have hidden a genuinely broken route.
 */
async function checkOAuthEntryPoint() {
  try {
    const response = await get("/api/email/connections/gmail/start", { method: "POST" });
    const location = response.headers.get("location") || "";
    const isGoogle = location.startsWith("https://accounts.google.com/");
    // Unauthenticated callers get bounced to login rather than to Google,
    // which is correct — so a redirect anywhere is a pass for "configured",
    // and only a 5xx is a real failure.
    record(
      "Gmail OAuth entry point responds without error",
      response.status < 500,
      isGoogle
        ? `redirects to Google; scope=${new URL(location).searchParams.get("scope")}`
        : `HTTP ${response.status}${location ? ` -> ${location.split("?")[0]}` : ""} (auth redirect expected when unauthenticated)`,
    );
    if (isGoogle) {
      const scope = new URL(location).searchParams.get("scope");
      record(
        "OAuth requests read-only Gmail scope and nothing more",
        scope === "https://www.googleapis.com/auth/gmail.readonly",
        `scope: ${scope}`,
      );
    }
  } catch (error) {
    record("Gmail OAuth entry point responds without error", false, error.message);
  }
}

async function checkTransportSecurity() {
  try {
    const response = await get("/");
    record("Served over HTTPS", BASE.startsWith("https://"), BASE.split("://")[0]);
    const hsts = response.headers.get("strict-transport-security");
    record("HSTS header present", Boolean(hsts), hsts || "absent (Vercel sets this on its own domains)");
  } catch (error) {
    record("Served over HTTPS", false, error.message);
  }
}

function reportManualSteps() {
  record("Backups / PITR retention confirmed", null, "Neon dashboard — check the retention window before real receipts exist", true);
  record(
    "Log drain delivering",
    null,
    "Sentry's Vercel integration was installed 2026-08-15 but delivery is UNVERIFIED — " +
      "confirm at Vercel → Settings → Log Drains (an entry should be listed) and by " +
      "checking a recent deploy appears under Sentry → Releases. Installing an " +
      "integration is not the same as logs arriving.",
    true,
  );
  record("Real Gmail account completed consent and imported a receipt", null, "needs a human with a real mailbox", true);
  record("Rollback rehearsed", null, "see DEPLOYMENT.md §7 — must be performed once, not just read", true);
}

async function main() {
  console.log(`Verifying ${BASE}\n`);
  const health = await checkHealth();
  await checkMerchantEndpointClosed();
  await checkOAuthEntryPoint();
  await checkTransportSecurity();
  reportManualSteps();

  const automated = results.filter((result) => !result.manual);
  const manual = results.filter((result) => result.manual);

  console.log("Automated checks");
  for (const { name, ok, detail } of automated) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}\n        ${detail}`);
  }
  console.log("\nManual checks — not verifiable from here, do not mark done without doing them");
  for (const { name, detail } of manual) {
    console.log(`  TODO  ${name}\n        ${detail}`);
  }

  const failed = automated.filter((result) => !result.ok);
  console.log(`\n${automated.length - failed.length}/${automated.length} automated checks passed.`);
  if (health) console.log(`Deployment reports status="${health.status}".`);
  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const { name, detail } of failed) console.log(`  - ${name}: ${detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`verification failed to run: ${error.message}`);
  process.exit(2);
});
