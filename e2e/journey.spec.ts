import { expect, test, type Page } from "@playwright/test";

/**
 * The journey a human walks, in a real browser: create an account, land
 * on the vault, add a receipt by hand, see it listed, sign out and back
 * in.
 *
 * The assertion that matters most is the last one in each test: **no
 * uncaught page error and no console error anywhere in the journey.** A
 * component that throws during render, a hydration mismatch, or a handler
 * that blows up on click all leave the HTTP response at 200 —
 * `scripts/smoke-test.mjs` passes happily on a page no human can use, and
 * says so in its own header. That is external review finding #12.
 */

function uniqueUsername(): string {
  return `e2e_${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct horse battery staple";

/** Collects anything the page itself reports as broken. */
function watchForClientErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console.error: ${message.text()}`);
  });
  return problems;
}

async function createAccount(page: Page, username: string): Promise<void> {
  await page.goto("/signin");
  // Registration is a tab on the sign-in form, not its own page — one
  // component for both actions, deliberately (see SignInForm.tsx).
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("create an account, add a receipt by hand, and see it in the vault", async ({ page }) => {
  const problems = watchForClientErrors(page);
  const username = uniqueUsername();

  await createAccount(page, username);

  // Waiting on content rather than on the URL: a redirect that lands on a
  // blank page is exactly the failure this test exists to catch.
  await expect(page.getByRole("heading", { name: "Your vault" })).toBeVisible();

  await page.goto("/receipts/new");
  await page.getByRole("button", { name: "Enter manually" }).click();

  await page.getByLabel("Merchant").fill("Playwright Coffee");
  await page.getByLabel("Amount").fill("4.20");
  await page.getByRole("button", { name: "Save receipt" }).click();

  await expect(page.getByText("Playwright Coffee")).toBeVisible();

  expect(problems, `client-side problems during the journey:\n${problems.join("\n")}`).toEqual([]);
});

test("an existing account can sign in again", async ({ page }) => {
  const problems = watchForClientErrors(page);
  const username = uniqueUsername();

  await createAccount(page, username);
  await expect(page.getByRole("heading", { name: "Your vault" })).toBeVisible();

  // Session 10 shipped a working login API with no sign-in UI at all, and
  // 219 API tests could not see it. This is the assertion that would have.
  await page.context().clearCookies();
  await page.goto("/signin");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Your vault" })).toBeVisible();
  expect(problems, `client-side problems during sign-in:\n${problems.join("\n")}`).toEqual([]);
});
