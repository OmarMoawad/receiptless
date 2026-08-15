#!/usr/bin/env node
/**
 * A browser-free smoke test of the paths a human actually walks.
 *
 * Two bugs shipped to production this session that 219 passing tests
 * could not see: there was no sign-in UI at all, and no Gmail UI at all.
 * Both backends worked and were tested. Neither was reachable.
 *
 * The root cause is structural — every test in this repo calls the API
 * directly, and a test that posts to `/api/auth/login` proves the endpoint
 * works while saying nothing about whether any human can reach it.
 *
 * This walks the actual journey over HTTP against a running deployment:
 * register, sign in, land on the vault, and confirm the connected-account
 * UI is present. It uses fetch rather than a browser so it can run
 * anywhere with no extra dependency; that is a real limitation — it
 * cannot catch a component that throws at render — and a Playwright suite
 * would be strictly better. It is a floor, not a ceiling.
 *
 * Usage:
 *   node scripts/smoke-test.mjs http://localhost:3000
 *   node scripts/smoke-test.mjs https://receiptless-theta.vercel.app
 *
 * Creates a throwaway account with a random username. Point it at a
 * deployment where that is acceptable — it refuses to guess.
 */
const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || "").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);

if (!BASE) {
  console.error("usage: node scripts/smoke-test.mjs <base-url>");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** A throwaway identity: lowercase start, then letters/digits/underscores. */
const username = `smoke_${Math.random().toString(36).slice(2, 10)}`;
const password = `smoke-${Math.random().toString(36).slice(2)}-${Date.now()}`;

let cookie = "";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { ...(options.headers ?? {}), ...(cookie ? { cookie } : {}) },
      redirect: "manual",
      signal: controller.signal,
    });
    // Carry the session forward the way a browser would.
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Smoke-testing ${BASE} as ${username}\n`);

  // 1. The entry point a signed-out person lands on must offer a way in.
  const home = await request("/");
  check(
    "Signed-out homepage links to sign-in",
    home.text.includes("/signin"),
    home.text.includes("/signin") ? "found /signin" : "NO LINK — the app has no visible way to sign in",
  );

  // 2. The sign-in page must render a real form, not just exist.
  const signin = await request("/signin");
  const hasPassword = /type="password"/.test(signin.text);
  check("Sign-in page renders a password field", signin.status === 200 && hasPassword, `HTTP ${signin.status}`);

  // 3. Registration through the same endpoint the form posts to.
  const registered = await request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  check("Can create an account", registered.status === 201, `HTTP ${registered.status}`);

  // 4. A session cookie must actually come back, or nothing below is real.
  check("Registration returns a session cookie", Boolean(cookie), cookie ? "cookie set" : "no set-cookie header");

  // 5. The vault renders for the signed-in user.
  const vault = await request("/receipts");
  check("Signed-in vault renders", vault.status === 200 && vault.text.includes("Your vault"), `HTTP ${vault.status}`);

  // 6. The bug that shipped: connected-account UI present on the page.
  check(
    "Gmail connection UI is on the vault page",
    vault.text.includes("Connect Gmail") || vault.text.includes("Connect another account"),
    vault.text.includes("Gmail") ? "Gmail panel present" : "NO GMAIL UI — the OAuth backend is unreachable from the app",
  );

  // 7. Signing out should work and stop the session working.
  const loggedOut = await request("/api/auth/logout", { method: "POST" });
  check("Can sign out", loggedOut.status === 204, `HTTP ${loggedOut.status}`);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const { name, detail } of failed) console.log(`  - ${name}: ${detail}`);
    process.exit(1);
  }
  console.log(`\nLeft behind a throwaway account: ${username}`);
}

main().catch((error) => {
  console.error(`smoke test could not run: ${error.message}`);
  process.exit(2);
});
