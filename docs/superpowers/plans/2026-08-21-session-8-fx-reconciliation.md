# Phase 2 Session 8 FX Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile historical receipts into the owner's current reporting currency through an explicit Settings flow while fixing cold-cache holiday lookup, concurrency, and stale-target reporting defects.

**Architecture:** The resolver requests one bounded seven-day provider window and remains the date-policy authority. A read-only preview and owner-scoped sequential apply service process deterministic batches of ten, using immutable conversion versions and existing provenance fields.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma/Postgres, Vitest, React, Apify CBE adapter.

**Spec:** `docs/superpowers/specs/2026-08-21-session-8-fx-reconciliation-design.md`

## Global Constraints

- Lookback is the inclusive interval `[purchase date - 7 days, purchase date]` in one provider request.
- Preview performs no writes and calls no provider.
- Apply is authenticated, same-origin protected, owner-scoped, sequential, and capped at ten receipts/request.
- Existing conversion versions are retained; old-target conversions are reprocessed only after explicit Apply.
- Tax reports use only an approved snapshot matching receipt source currency and current reporting currency.
- Apify authentication uses `Authorization: Bearer`; tokens never appear in URLs/logs.

---

### Task 1: Provider window lookup and Apify credential hardening

**Files:**
- Modify: `src/lib/fx/provider.ts`
- Modify: `src/lib/fx/rates.ts`
- Modify: `src/lib/fx/provider.test.ts`
- Modify: `src/lib/fx/provider-fetch.test.ts`
- Modify: `src/lib/fx/providers/apify-cbe.ts`
- Modify: `src/lib/fx/providers/apify-cbe.test.ts`

**Interfaces:**
- Produces: `FxRateWindow = { from: Date; on: Date }` and `FxRateProvider.fetchRate(base, quote, window)`.
- Produces: `quoteFromRows(rows, base, quote, side, window)` returning the newest valid in-window quote.

- [ ] **Step 1: Write failing weekend, ordering, range, and auth tests**

```ts
const quote = await provider.fetchRate("EGP", "USD", { from: friday, on: sunday });
expect(quote?.effectiveDate).toEqual(friday);
expect(fetchRequest.headers.get("authorization")).toBe("Bearer test-token");
expect(fetchRequest.url).not.toContain("test-token");
expect(quoteFromRows([thursdayRow, fridayRow], "EGP", "USD", "mid", window)?.effectiveDate).toEqual(friday);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/lib/fx/provider.test.ts src/lib/fx/provider-fetch.test.ts src/lib/fx/providers/apify-cbe.test.ts`

Expected: FAIL because the provider accepts one date and places the token in the URL.

- [ ] **Step 3: Implement one inclusive range request and defensive date checks**

```ts
export type FxRateWindow = { from: Date; on: Date };
export interface FxRateProvider {
  readonly id: string;
  fetchRate(base: string, quote: string, window: FxRateWindow): Promise<FxRateQuote | null>;
}
```

The resolver computes the window once, rejects provider dates outside it before persistence, and the CBE adapter selects by greatest valid effective date rather than response order.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- src/lib/fx/provider.test.ts src/lib/fx/provider-fetch.test.ts src/lib/fx/providers/apify-cbe.test.ts`

Expected: PASS with one cold-cache provider call.

```bash
git add src/lib/fx
git commit -m "fix: resolve cold-cache FX rates across holidays"
```

### Task 2: Current-target reporting and conversion race safety

**Files:**
- Modify: `src/lib/fx/conversion-service.ts`
- Modify: `src/lib/fx/conversion-service.test.ts`
- Modify: `src/lib/tax-summary.ts`
- Modify: `src/lib/tax-summary.test.ts`

**Interfaces:**
- Produces: `captureConversion(receiptId, context?)` with optional audit context and P2002 winner reread.
- Produces: `approvedConversion(receiptId, targetCurrency)` that returns only a source/target-compatible snapshot.

- [ ] **Step 1: Write failing concurrency and stale-target tests**

```ts
const [left, right] = await Promise.all([captureConversion(receipt.id), captureConversion(receipt.id)]);
expect(left.status).toBe("converted");
expect(right.status).toBe("converted");
expect(await prisma.receiptConversion.count({ where: { receiptId: receipt.id, approved: true } })).toBe(1);
expect((await taxSummary(owner.id, 2026)).unconvertedReceiptIds).toContain(receipt.id);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/fx/conversion-service.test.ts src/lib/tax-summary.test.ts`

Expected: FAIL on concurrent insert or stale-target summary behavior.

- [ ] **Step 3: Implement compatible snapshot selection and race recovery**

```ts
export type ConversionAuditContext = { operator: string; reason: string; correlationId: string };

export async function approvedConversion(
  receiptId: string,
  sourceCurrency: string,
  targetCurrency: string,
): Promise<ReceiptConversion | null>;
```

Catch only the receipt-conversion unique `P2002`, reread the compatible approved winner, and rethrow unrelated database errors. Tax summary treats wrong-target snapshots as unconverted.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/fx/conversion-service.test.ts src/lib/tax-summary.test.ts`

Expected: PASS.

```bash
git add src/lib/fx/conversion-service.ts src/lib/fx/conversion-service.test.ts src/lib/tax-summary.ts src/lib/tax-summary.test.ts
git commit -m "fix: keep FX snapshots aligned with reporting currency"
```

### Task 3: Owner-scoped preview and apply service

**Files:**
- Create: `src/lib/fx/reconciliation-service.ts`
- Create: `src/lib/fx/reconciliation-service.test.ts`

**Interfaces:**
- Produces: `previewFxReconciliation(ownerId)` and `applyFxReconciliation(ownerId, input)`.
- Produces: opaque cursor `{ purchasedAt: string; id: string }` and category counts from the spec.

- [ ] **Step 1: Write failing preview/apply tests**

```ts
const before = await snapshotFxTableCounts();
const preview = await previewFxReconciliation(alice.id);
expect(await snapshotFxTableCounts()).toEqual(before);
expect(provider.calls).toHaveLength(0);
const result = await applyFxReconciliation(alice.id, { limit: 10, expectedReportingCurrency: "EGP", correlationId });
expect(result.processed).toBeLessThanOrEqual(10);
expect(await conversionsFor(bob.id)).toHaveLength(0);
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/fx/reconciliation-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement deterministic classification and sequential apply**

```ts
export type ApplyFxReconciliationInput = {
  cursor?: { purchasedAt: string; id: string };
  limit: number;
  expectedReportingCurrency: string;
  correlationId: `fx-reconciliation:${string}`;
};
```

Query through `ownerId`, order by `purchasedAt,id`, classify against the current currency, call capture/reprocess sequentially, preserve per-row safe failures, and reject a stale expected currency.

- [ ] **Step 4: Run test and commit**

Run: `npm test -- src/lib/fx/reconciliation-service.test.ts`

Expected: PASS including tenant isolation and unavailable continuation.

```bash
git add src/lib/fx/reconciliation-service.ts src/lib/fx/reconciliation-service.test.ts
git commit -m "feat: reconcile historical FX snapshots in bounded batches"
```

### Task 4: Authenticated endpoints, validation, and rate limits

**Files:**
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/rate-limit/policy.ts`
- Modify: `src/lib/rate-limit/rate-limit.test.ts`
- Create: `src/app/api/fx/reconciliation/preview/route.ts`
- Create: `src/app/api/fx/reconciliation/preview/route.test.ts`
- Create: `src/app/api/fx/reconciliation/apply/route.ts`
- Create: `src/app/api/fx/reconciliation/apply/route.test.ts`

**Interfaces:**
- Produces: POST preview and POST apply response contracts consumed by Settings.

- [ ] **Step 1: Write failing route/rate tests**

```ts
expect((await POST_PREVIEW(requestWithoutSession())).status).toBe(401);
expect((await POST_APPLY(requestFor(alice, { limit: 11 }))).status).toBe(400);
expect(RATE_LIMIT_POLICIES["fx-reconciliation-apply"]).toMatchObject({ subject: "session", limit: 12, windowSeconds: 3600 });
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/app/api/fx/reconciliation src/lib/rate-limit/rate-limit.test.ts`

Expected: FAIL because routes/schemas/policies are absent.

- [ ] **Step 3: Implement request contracts and owner-only handlers**

Preview limit: 30/hour/session. Apply limit: 12/hour/session. Validate UUID correlation IDs, cursor dates/IDs, exact expected currency, and `limit` from 1 through 10. Use `getCurrentUser`; never accept owner ID in a body.

- [ ] **Step 4: Run route tests and commit**

Run: `npm test -- src/app/api/fx/reconciliation src/lib/rate-limit/rate-limit.test.ts`

Expected: PASS including the existing repository-wide mutating-route coverage guard.

```bash
git add src/lib/validation.ts src/lib/rate-limit src/app/api/fx
git commit -m "feat: expose owner-scoped FX reconciliation endpoints"
```

### Task 5: Settings preview, apply, and progress UI

**Files:**
- Modify: `src/app/settings/page.tsx`
- Create: `src/app/settings/fx-reconciliation.tsx`
- Create: `src/app/settings/fx-reconciliation.test.tsx`

**Interfaces:**
- Consumes: POST preview/apply contracts and continuation cursor.
- Produces: explicit preview/apply control and cumulative category progress.

- [ ] **Step 1: Write failing component behavior tests**

```tsx
expect(screen.getByText(/estimate, not a guarantee/i)).toBeVisible();
await user.click(screen.getByRole("button", { name: /apply reconciliation/i }));
expect(await screen.findByText(/converted 1/i)).toBeVisible();
expect(screen.getByText(/unavailable 1/i)).toBeVisible();
```

- [ ] **Step 2: Run component test and verify failure**

Run: `npm test -- src/app/settings/fx-reconciliation.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement preview/apply state machine**

Use states `idle | loadingPreview | ready | applying | complete | error`; generate one browser UUID correlation ID per apply run, send batches until cursor is null, preserve cumulative results, and stop safely on stale-currency/401 errors.

- [ ] **Step 4: Run component tests and commit**

Run: `npm test -- src/app/settings/fx-reconciliation.test.tsx`

Expected: PASS.

```bash
git add src/app/settings
git commit -m "feat: add FX reconciliation to settings"
```

### Task 6: Full verification and Phase 2 closure

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `RECEIPTLESS_STATE.md`
- Modify: `DEPLOYMENT.md`
- Modify: `docs/SETUP-ACCOUNTS.md`
- Modify: `scripts/generate-progress-svg.mjs`
- Modify: `docs/progress.svg`

**Interfaces:**
- Produces: evidence-backed Session 8/Phase 2 status and Phase 3 as the next phase.

- [ ] **Step 1: Run full automated verification**

Run: `npm run db:generate`

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

Expected: every command exits 0.

- [ ] **Step 2: Verify the Settings journey against production-safe data**

Preview without writes, apply to the known historical foreign-currency receipt, verify current-target snapshot/provenance and tax summary, rerun to prove idempotency, and confirm `/api/health` is 200 after any required migration deployment. Record counts, not sensitive receipt details.

- [ ] **Step 3: Correct stale documentation and regenerate progress**

Record the CBE adapter as implemented/configured, Session 8 as the final Vault Maturity session, and the deferred Vercel Pro/log drain as separately open rather than silently closed. Set Phase 3 Merchant API/SDK as next.

Run: `node scripts/generate-progress-svg.mjs`

- [ ] **Step 4: Commit verified closure**

```bash
git add README.md ROADMAP.md RECEIPTLESS_STATE.md DEPLOYMENT.md docs/SETUP-ACCOUNTS.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: close vault maturity after FX reconciliation"
```
