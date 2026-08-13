/**
 * Session 8 (RECEIPTLESS_STATE.md): deployment-environment gates.
 *
 * Everything here answers one question — "is it safe for the public
 * internet to reach this?" — in code rather than in a doc comment. The
 * `/api/merchant/receipts` endpoint is the reason this file exists: it is
 * unauthenticated and unrate-limited by design (it simulates a POS
 * terminal until Phase 3's merchant API keys exist), so it creates
 * database rows and claim tokens for anyone who can reach it. A comment
 * saying "local/demo use only" is not a control; an env gate is.
 */

/**
 * Vercel sets VERCEL_ENV to production/preview/development. NODE_ENV alone
 * is not enough: a preview deployment also builds with NODE_ENV=production
 * but is still publicly reachable, so both are treated as "deployed".
 */
export function isDeployedEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VERCEL_ENV) || env.NODE_ENV === "production";
}

/**
 * The unauthenticated merchant endpoint is **off by default anywhere the
 * internet can reach it**, and must be switched on deliberately. Locally
 * it stays on without configuration so the demo/claim flow keeps working
 * out of the box.
 *
 * Deliberately fails closed: only the exact string "true" enables it, so a
 * typo, an empty value, or a stray "1" leaves it disabled rather than
 * silently opening the endpoint.
 */
export function isMerchantApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.MERCHANT_API_ENABLED?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return !isDeployedEnvironment(env);
}

/**
 * Configuration that must be present before a deployment is allowed to
 * serve real traffic. Returned as a list rather than thrown, so a health
 * endpoint can report everything missing at once instead of one item per
 * redeploy.
 */
export function missingProductionConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isDeployedEnvironment(env)) return [];
  const required = ["DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !env[key]?.trim());

  // Inbound email is optional as a feature, but half-configured inbound
  // email is a real hazard: a webhook reachable without both credentials
  // set would be an open ingestion endpoint.
  const postmarkKeys = ["POSTMARK_WEBHOOK_USERNAME", "POSTMARK_WEBHOOK_PASSWORD", "POSTMARK_INBOUND_ADDRESS"];
  const postmarkSet = postmarkKeys.filter((key) => env[key]?.trim());
  if (postmarkSet.length > 0 && postmarkSet.length < postmarkKeys.length) {
    missing.push(...postmarkKeys.filter((key) => !env[key]?.trim()));
  }

  return missing;
}
