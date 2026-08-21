# Phase 3 Session 6 Square Receipt Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn authenticated Square completed-payment notifications into idempotent canonical Receiptless receipts and claim tokens.

**Architecture:** A public webhook adapter validates Square's raw-body HMAC before parsing and stores delivery identity for replay protection. Webhooks are signals: a worker/service refreshes credentials, retrieves Payment/Order/merchant/location, normalizes into the provider-neutral merchant receipt contract, and invokes the existing idempotent issuer.

**Tech Stack:** TypeScript, Next.js, Prisma/Postgres, Square Payments/Orders APIs, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Validate `x-square-hmacsha256-signature` against raw bytes, exact notification URL, and subscription secret before JSON parsing.
- Process only `payment.updated` whose authoritative fetched Payment status is `COMPLETED` and has an order ID.
- Retrieve authoritative objects; never build a receipt solely from webhook fields.
- Provider event/payment/order IDs establish replay/idempotency; per-event failure remains retryable.
- Square receipts are `MERCHANT_VERIFIED` unless a separate valid merchant-held attestation is supplied.

---

### Task 1: Webhook delivery/reprocessing persistence and HMAC adapter

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821225000_add_pos_webhook_deliveries/migration.sql`
- Create: `src/lib/pos/square-webhook.ts`
- Create: `src/lib/pos/square-webhook.test.ts`

**Interfaces:**
- Produces: `validateSquareWebhook(rawBody, signature, notificationUrl, secret)` and `parseSquarePaymentSignal`.
- Produces: `PosWebhookDelivery` with `RECEIVED | PROCESSING | SUCCEEDED | RETRYABLE | DISCARDED` status and attempts/error code.

- [ ] **Step 1: Write failing official-vector/replay tests**

```ts
expect(validateSquareWebhook(rawBody, validSignature, url, secret)).toBe(true);
expect(validateSquareWebhook(tamperedBody, validSignature, url, secret)).toBe(false);
expect(parseSquarePaymentSignal(event)).toEqual({ eventId, paymentId });
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/pos/square-webhook.test.ts`

Expected: FAIL because adapter/model are absent.

- [ ] **Step 3: Implement raw-body HMAC and durable delivery state**

Use timing-safe signature comparison, bound body size before allocation, reject unsupported event types with acknowledged discarded state, and add unique `(provider, environment, providerEventId)` plus retry indexes.

- [ ] **Step 4: Generate, test, and commit**

Run: `npm run db:generate`

Run: `npm test -- src/lib/pos/square-webhook.test.ts`

Run: `npm run check:migrations`

```bash
git add prisma src/lib/pos/square-webhook.ts src/lib/pos/square-webhook.test.ts
git commit -m "feat: validate and persist Square webhook signals"
```

### Task 2: Square payment/order retrieval and canonical normalization

**Files:**
- Modify: `src/lib/pos/square-client.ts`
- Modify: `src/lib/pos/square-client.test.ts`
- Create: `src/lib/pos/square-normalizer.ts`
- Create: `src/lib/pos/square-normalizer.test.ts`
- Create: `src/lib/pos/fixtures/square-completed-order.json`

**Interfaces:**
- Produces: `retrievePayment`, `retrieveOrder`, and `normalizeSquareOrder(context): MerchantReceiptCreate`.

- [ ] **Step 1: Write failing completed-order money/provenance tests**

```ts
const normalized = normalizeSquareOrder(fixture);
expect(normalized.totalMinor).toBe(1250);
expect(normalized.items.reduce((sum, item) => sum + item.totalPriceMinor, 0)).toBeLessThanOrEqual(normalized.totalMinor);
expect(normalized.source).toBe("POS_API");
expect(normalized.externalReceiptId).toBe(fixture.order.id);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/pos/square-client.test.ts src/lib/pos/square-normalizer.test.ts`

Expected: FAIL because retrieval/normalizer are absent.

- [ ] **Step 3: Implement integer-money normalization**

Map Square line items, quantities, base prices, discounts, taxes, service charges, tenders, currency, closed time, order ID, merchant ID, and location ID. Reject mixed/unknown currencies, missing order linkage, non-completed payments, and values outside Postgres integer bounds with explicit safe codes.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/pos/square-client.test.ts src/lib/pos/square-normalizer.test.ts`

```bash
git add src/lib/pos
git commit -m "feat: normalize completed Square orders"
```

### Task 3: Ingestion orchestration, retries, and claim issuance

**Files:**
- Create: `src/lib/pos/square-ingestion.ts`
- Create: `src/lib/pos/square-ingestion.test.ts`
- Create: `src/app/api/webhooks/pos/square/route.ts`
- Create: `src/app/api/webhooks/pos/square/route.test.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/pos/deliveries/reprocess/route.ts`
- Modify: `src/lib/rate-limit/policy.ts`

**Interfaces:**
- Produces: `ingestSquarePaymentEvent(deliveryId)` and signed public webhook route.

- [ ] **Step 1: Write failing route/orchestration tests**

```ts
expect((await POST(unsignedRequest)).status).toBe(403);
const first = await ingestSquarePaymentEvent(delivery.id);
const replay = await ingestSquarePaymentEvent(delivery.id);
expect(replay.receiptId).toBe(first.receiptId);
expect(await deliveryStatus(delivery.id)).toBe("SUCCEEDED");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/pos/square-ingestion.test.ts src/app/api/webhooks/pos/square/route.test.ts`

Expected: FAIL because route/orchestrator are absent.

- [ ] **Step 3: Implement isolated retryable processing**

Reserve event before acknowledgement, refresh access token through connection service, verify merchant/location mapping, fetch/normalize, and call issuer with the template literal `` `square:payment:${payment.id}` `` as idempotency identity. Retry network/429/5xx with bounded exponential backoff plus jitter; mark invalid signature/mapping/currency as terminal safe codes. Manual reprocess requires account ADMIN and cannot cross accounts.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/pos/square-ingestion.test.ts src/app/api/webhooks/pos/square/route.test.ts src/app/api/merchant/accounts/[accountId]/pos/deliveries/reprocess/route.ts`

```bash
git add src/lib/pos/square-ingestion.ts src/lib/pos/square-ingestion.test.ts src/app/api/webhooks/pos src/app/api/merchant/accounts src/lib/rate-limit/policy.ts
git commit -m "feat: ingest Square payments into claimable receipts"
```

### Task 4: Delivery status UI and observability-safe diagnostics

**Files:**
- Create: `src/app/api/merchant/accounts/[accountId]/pos/deliveries/route.ts`
- Create: `src/app/merchant/pos-deliveries.tsx`
- Create: `src/app/merchant/pos-deliveries.test.tsx`
- Modify: `src/lib/observability.ts`
- Create: `src/lib/pos/square-log-redaction.test.ts`

- [ ] **Step 1: Write failing safe-status/redaction tests**

```tsx
expect(screen.getByText(/retryable/i)).toBeVisible();
expect(screen.queryByText(accessToken)).toBeNull();
expect(capturedLog).not.toContain(rawWebhookBody);
expect(capturedLog).toContain("square_order_unavailable");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/app/merchant/pos-deliveries.test.tsx src/lib/pos/square-log-redaction.test.ts`

Expected: FAIL because status UI/redaction coverage are absent.

- [ ] **Step 3: Implement bounded account-scoped delivery status**

Return event suffix/type/status/attempts/timestamps/safe code/receipt ID only. Add safe structured spans for webhook validation, fetch, normalization, idempotency, and issuance; redact authorization/signature/callback and request-body fields.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/app/merchant/pos-deliveries.test.tsx src/lib/pos/square-log-redaction.test.ts`

```bash
git add src/app/api/merchant/accounts src/app/merchant src/lib/observability.ts src/lib/pos/square-log-redaction.test.ts
git commit -m "feat: surface safe POS ingestion status"
```

### Task 5: Full verification and session evidence

- [ ] **Step 1: Run all automated checks**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

- [ ] **Step 2: Prove one Square sandbox webhook-to-claim flow**

Create/complete a Square sandbox order/payment, receive the signed event, verify one canonical receipt/claim token, replay the event to prove idempotency, and claim through the intended test surface. Record safe event/order suffixes and timestamps only.

- [ ] **Step 3: Update docs/state/progress and commit**

```bash
git add README.md DEPLOYMENT.md docs/SETUP-ACCOUNTS.md ROADMAP.md RECEIPTLESS_STATE.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record Square ingestion verification"
```
