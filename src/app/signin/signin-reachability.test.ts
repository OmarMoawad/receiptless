import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Session 10 slice — a regression test for the bug the whole suite missed.
 *
 * The deployed application told users to "Sign in" on two pages, shipped
 * working `/api/auth/login` and `/api/auth/register` endpoints with tests
 * around them, and **rendered no sign-in form anywhere**. There was no way
 * for a human to obtain a session. It survived nine sessions and a
 * production deployment.
 *
 * Every one of the 219 tests called the API directly. That is precisely
 * why none of them noticed: a test that posts to `/api/auth/login` proves
 * the endpoint works, and says nothing about whether any human can reach
 * it.
 *
 * These tests are deliberately structural — they read the source rather
 * than render it. A full render test would be better, but this repo has no
 * component-test setup, and the failure mode here is not "the form
 * misbehaves", it is "the form does not exist". Checking existence and
 * reachability catches exactly that, cheaply, and would have failed loudly
 * on the code as it shipped.
 */

const root = resolve(import.meta.dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("connected-account features are reachable by a human", () => {
  // The same bug as sign-in, in the same repo, found the same way: Session
  // 9 shipped the whole Gmail OAuth backend — PKCE, encrypted tokens,
  // refresh, disconnect, scanning — with tests, and no UI whatsoever. Not
  // one occurrence of "gmail" existed in any component.
  it("renders a Gmail connection UI that reaches the OAuth endpoints", () => {
    const component = read("src/components/GmailConnections.tsx");
    expect(component).toContain("/api/email/connections/gmail/start");
    expect(component).toContain("/api/email/connections");
    // Scan and disconnect are useless if unreachable too.
    expect(component).toContain("/scan");
    expect(component).toContain("/disconnect");
  });

  it("is actually mounted on a page, not merely defined", () => {
    // A component nobody renders is the same defect as no component.
    expect(read("src/app/receipts/page.tsx")).toContain("GmailConnections");
  });

  it("surfaces the callback's own result parameter", () => {
    // gmail/callback redirects to /receipts?gmail=connected|failed|
    // unconfigured, and nothing read it — so the outcome of consent was
    // invisible either way.
    const component = read("src/components/GmailConnections.tsx");
    for (const outcome of ["connected", "failed", "unconfigured", "expired", "denied"]) {
      expect(component).toContain(outcome);
    }
  });
});

describe("sign-in is reachable by a human", () => {
  it("has a sign-in page", () => {
    expect(existsSync(resolve(root, "src/app/signin/page.tsx"))).toBe(true);
  });

  it("renders a password field and posts to the auth endpoints", () => {
    // The specific thing that was absent from the entire codebase: not one
    // password input existed outside of tests.
    const form = read("src/app/signin/SignInForm.tsx");
    expect(form).toContain('type="password"');
    expect(form).toContain("/api/auth/login");
    expect(form).toContain("/api/auth/register");
  });

  it("links to sign-in from every page that tells the user to sign in", () => {
    // A dead end with instructions is still a dead end. Any page that says
    // "sign in" must offer the way to do it.
    for (const page of ["src/app/page.tsx", "src/app/receipts/page.tsx"]) {
      const source = read(page);
      if (/Sign in|sign in/i.test(source)) {
        expect(source, `${page} tells the user to sign in but does not link to /signin`).toContain("/signin");
      }
    }
  });
});
