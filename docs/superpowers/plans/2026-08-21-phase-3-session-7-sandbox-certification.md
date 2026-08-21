# Phase 3 Session 7 Square Sandbox Certification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Certify the complete Square sandbox journey, harden operations/security, and make the integration ready for a real merchant pilot.

**Architecture:** A repeatable verification script and browser journey exercise OAuth, mapping, Square payment/webhook retrieval, canonical issuance, claim, and vault/report provenance. Operational checks cover alerting, retries, rate/load boundaries, secrets, rotation, rollback, and pilot onboarding.

**Tech Stack:** TypeScript, Playwright, Square Sandbox, Next.js, Prisma/Postgres, Sentry/log sink, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Evidence contains no customer data, raw tokens, webhook signatures, receipt bodies, or full provider IDs.
- Sandbox certification cannot mark Phase 3 complete or satisfy the real-pilot Session 8 gate.
- Verification must be repeatable from documented setup and fail closed on wrong environment.
- Rollback/reprocessing cannot delete issued consumer receipts or audit evidence.

---

### Task 1: Automated sandbox verifier and evidence schema

**Files:**
- Create: `scripts/verify-square-sandbox.mjs`
- Create: `scripts/verify-square-sandbox.test.ts`
- Create: `docs/verification/square-sandbox-evidence.schema.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run verify:square-sandbox` and redacted JSON evidence validated by the schema.

- [ ] **Step 1: Write failing environment/redaction tests**

```ts
expect(() => validateSandboxEnv({ SQUARE_ENVIRONMENT: "production" })).toThrow(/sandbox only/i);
expect(redactedEvidence).not.toHaveProperty("accessToken");
expect(redactedEvidence.steps.map((step) => step.status)).toEqual(["pass", "pass", "pass"]);
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- scripts/verify-square-sandbox.test.ts`

Expected: FAIL because verifier/schema are absent.

- [ ] **Step 3: Implement bounded verifier**

The script checks health/config, connected sandbox merchant/location mapping, waits with a fixed deadline for a specified sandbox payment ID, verifies delivery/receipt/claim/provenance, replays safely, and emits timestamps plus last-six provider identifiers. It never creates a payment itself and requires the operator to supply the sandbox payment ID.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- scripts/verify-square-sandbox.test.ts`

```bash
git add scripts/verify-square-sandbox.mjs scripts/verify-square-sandbox.test.ts docs/verification package.json
git commit -m "test: add repeatable Square sandbox certification"
```

### Task 2: Browser end-to-end merchant-to-consumer journey

**Files:**
- Create: `e2e/square-sandbox-journey.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing controlled-browser journey**

```ts
await expect(page.getByText(/square sandbox connected/i)).toBeVisible();
await expect(page.getByText(/mapped/i)).toBeVisible();
await page.goto(claimUrl);
await page.getByRole("button", { name: /claim receipt/i }).click();
await expect(page.getByText(/merchant verified/i)).toBeVisible();
```

- [ ] **Step 2: Run local mocked-provider journey and verify failure**

Run: `npx playwright test e2e/square-sandbox-journey.spec.ts`

Expected: FAIL until fixtures/setup expose the completed flow.

- [ ] **Step 3: Implement deterministic local provider fixture and live-sandbox opt-in**

Default CI uses signed official-shape fixtures through the real webhook/normalizer/issuer paths. `SQUARE_LIVE_SANDBOX=1` switches only provider calls to Square sandbox and is excluded from ordinary CI secrets. Assert no console/page errors and full merchant/consumer isolation.

- [ ] **Step 4: Run journey and commit**

Run: `npx playwright test e2e/square-sandbox-journey.spec.ts`

```bash
git add e2e/square-sandbox-journey.spec.ts playwright.config.ts .github/workflows/ci.yml
git commit -m "test: cover the Square receipt journey end to end"
```

### Task 3: Security, load, rotation, and recovery drills

**Files:**
- Create: `docs/security/merchant-api-review.md`
- Create: `docs/operations/merchant-api-runbook.md`
- Create: `scripts/check-merchant-secret-leaks.mjs`
- Create: `scripts/check-merchant-secret-leaks.test.ts`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Write failing secret-leak scanner tests**

```ts
expect(scan("Authorization: Bearer rl_live_secret")).toContain("merchant-api-key");
expect(scan("x-square-hmacsha256-signature: abc")).toContain("square-webhook-signature");
expect(scan("merchant key prefix rl_live_ab12")).toEqual([]);
```

- [ ] **Step 2: Run scanner tests and verify failure**

Run: `npm test -- scripts/check-merchant-secret-leaks.test.ts`

Expected: FAIL because scanner is absent.

- [ ] **Step 3: Implement checks and execute operational drills**

Document and run: invalid-key flood limit, valid-key burst/account effect ceiling, webhook replay storm, OAuth state replay, API/signing-key rotation, Square token refresh/disconnect, retryable delivery recovery, migration rollback rehearsal, and alert delivery. Record command, timestamp, duration, safe result, and remediation for failures.

- [ ] **Step 4: Run scanner and commit reviewed artifacts**

Run: `node scripts/check-merchant-secret-leaks.mjs .`

Run: `npm test -- scripts/check-merchant-secret-leaks.test.ts`

```bash
git add docs/security docs/operations scripts/check-merchant-secret-leaks.mjs scripts/check-merchant-secret-leaks.test.ts DEPLOYMENT.md
git commit -m "security: certify merchant API pilot readiness"
```

### Task 4: Live-pilot onboarding and runback package

**Files:**
- Create: `docs/pilot/square-merchant-onboarding.md`
- Create: `docs/pilot/square-live-pilot-checklist.md`
- Create: `docs/pilot/square-runback.md`

- [ ] **Step 1: Write exact onboarding and consent checklist**

Include merchant contact/authorization owner, scopes, privacy/data handling explanation, selected location, test/refund policy, support/escalation contacts, success criteria, observation window, and written approval before any genuine transaction.

- [ ] **Step 2: Write exact runback decisions**

Disable webhook subscription, disconnect/revoke OAuth, revoke Receiptless API/signing keys if used, preserve issued receipts/audit evidence, stop retries, communicate impact, and define re-enable criteria.

- [ ] **Step 3: Rehearse onboarding/runback against sandbox**

Use a sandbox merchant and record elapsed time plus any step requiring undocumented knowledge. Fix the documents until a second pass succeeds without repository knowledge.

- [ ] **Step 4: Commit**

```bash
git add docs/pilot
git commit -m "docs: add Square live-pilot onboarding and runback"
```

### Task 5: Final Session 7 certification and truthful progress

- [ ] **Step 1: Run all automated verification**

Run: `npm run db:generate`

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

Run: `npm run e2e`

Run: `node scripts/check-merchant-secret-leaks.mjs .`

- [ ] **Step 2: Run live Square sandbox certification**

Run: `npm run verify:square-sandbox -- --payment-id "$SQUARE_SANDBOX_PAYMENT_ID"`

Expected: all schema-defined steps `pass`; no secrets in evidence.

Run: `npm audit --audit-level=high`

Expected: no high/critical production dependency advisory.

- [ ] **Step 3: Update state/progress as pilot-ready, not Phase 3 complete**

Record Sessions 1–7 complete, Session 8 `blocked_external: no live Square merchant`, evidence path, current test counts, and exact next action.

- [ ] **Step 4: Commit**

```bash
git add README.md ROADMAP.md RECEIPTLESS_STATE.md DEPLOYMENT.md docs/verification scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: certify Square sandbox and mark pilot ready"
```
