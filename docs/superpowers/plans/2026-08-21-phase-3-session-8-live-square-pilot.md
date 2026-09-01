# Phase 3 Session 8 Live Square Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete one genuine merchant-authorized Square POS receipt journey and close Receiptless Phase 3 with real evidence.

**Architecture:** This is an operational evidence session using the production-ready system from Sessions 1–7. No transaction, merchant authorization, or production configuration change occurs without the participating merchant and Omar's explicit approval; defects found during the pilot receive separate test-first fixes before rerun.

**Tech Stack:** Square production OAuth/POS, Receiptless production deployment, Vercel, Postgres, browser verification, existing pilot runbooks.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Current status is `blocked_external` because no live Square merchant is available.
- A sandbox merchant/payment cannot satisfy this plan.
- The participating merchant must give informed authorization for scopes, location, test/refund procedure, and observation window.
- Do not create a charge, refund, disconnect, revoke, or expose production credentials without explicit human authorization at that step.
- Evidence excludes customer data, full receipt contents, credentials, webhook signatures, and full provider identifiers.

---

### Task 1: Satisfy the external entry gate

**Files:**
- Read: `docs/pilot/square-merchant-onboarding.md`
- Read: `docs/pilot/square-live-pilot-checklist.md`

- [ ] **Step 1: Confirm named merchant and authorized operator**

Record business contact, participating Square location, who can authorize the app, and who can approve/refund the test purchase in the private pilot record. Do not commit personal contact data.

- [ ] **Step 2: Obtain explicit scope/data/test approval**

Merchant approves `MERCHANT_PROFILE_READ`, `ORDERS_READ`, `PAYMENTS_READ`, receipt data processing, one genuine purchase, refund disposition, support contact, and observation window.

- [ ] **Step 3: Verify production prerequisites read-only**

Run: `node scripts/verify-deployment.mjs "$RECEIPTLESS_PRODUCTION_URL"`

Expected: health/readiness, migrations, observability, merchant API, encryption keys, and webhook configuration all pass before OAuth.

### Task 2: Authorize and map the live merchant

- [ ] **Step 1: Start production Square OAuth from the correct merchant account**

The merchant operator completes Square consent in their own session. Confirm returned Square merchant ID suffix matches the intended business.

- [ ] **Step 2: Map only the approved Square location**

Verify Receiptless location metadata with the merchant; do not map other locations visible in the Square account.

- [ ] **Step 3: Run pre-transaction webhook and runback checks**

Confirm subscription URL/signature secret, delivery-status page, alert channel, and the exact operator authorized to invoke `docs/pilot/square-runback.md`.

### Task 3: Execute and observe one genuine POS journey

- [ ] **Step 1: Obtain immediate approval for the purchase**

Confirm item/amount/payment/refund treatment with merchant and Omar. Stop if approval is absent or differs from onboarding record.

- [ ] **Step 2: Complete the purchase in Square POS**

Record start timestamp and last-six payment/order identifiers in the private pilot evidence. Never paste full card/customer/order data into repository files.

- [ ] **Step 3: Verify webhook-to-receipt processing**

Confirm one signed webhook delivery, authoritative retrieval, mapped location, canonical money/items, `MERCHANT_VERIFIED` or valid `SIGNED` state, one claim token, no retry loop, and no duplicate receipt after replay.

- [ ] **Step 4: Claim and verify the consumer experience**

Using the authorized consumer test account, claim the receipt and verify detail, search, tax/report currency handling, source/provenance, and authenticity language. Confirm the receipt is invisible to another consumer.

### Task 4: Review telemetry, merchant feedback, and defects

- [ ] **Step 1: Review the observation window**

Check OAuth refresh, webhook failures/retries, rate limits, latency, claim failures, duplicate/idempotency conflicts, and secret-redaction alerts for the agreed window.

- [ ] **Step 2: Collect merchant feedback**

Record onboarding difficulty, receipt completeness, latency, support issues, and whether ongoing authorization is approved. Commit only anonymized product findings.

- [ ] **Step 3: Classify every defect**

Security/data-integrity defects stop the pilot and trigger runback. Other defects receive a failing regression test and fix on a dedicated branch before the live journey is repeated. Do not accept an unresolved defect silently.

- [ ] **Step 4: Apply agreed purchase disposition**

If the purchase was designated for refund, the merchant performs/approves it through Square. Receiptless records no hidden deletion or rollback; the issued receipt/audit history remains.

### Task 5: Close or honestly retain the phase gate

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `RECEIPTLESS_STATE.md`
- Modify: `DEPLOYMENT.md`
- Modify: `docs/pilot/square-live-pilot-checklist.md`
- Create: `docs/verification/square-live-pilot.md`
- Modify: `scripts/generate-progress-svg.mjs`
- Modify: `docs/progress.svg`

- [ ] **Step 1: Run final automated verification after any fixes**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

Run: `npm run e2e`

- [ ] **Step 2: Write redacted evidence**

Record date/time, merchant pseudonym, location/payment/order suffixes, statuses and durations for OAuth/webhook/retrieval/issuance/claim, authenticity level, test commands, observation result, feedback summary, defect disposition, and whether ongoing authorization remains.

- [ ] **Step 3: Decide gate from evidence**

Mark Phase 3 complete only if all required journey steps passed and no unaccepted security/data-integrity defect remains. Otherwise keep Session 8 open with the exact failed criterion and next authorized action.

- [ ] **Step 4: Regenerate progress and commit only truthful state**

Run: `node scripts/generate-progress-svg.mjs`

```bash
git add README.md ROADMAP.md RECEIPTLESS_STATE.md DEPLOYMENT.md docs/pilot docs/verification scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record the live Square pilot and close phase 3"
```
