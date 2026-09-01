# Phase 3 Session 2 Merchant API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deployed anonymous merchant simulator with scoped, revocable merchant API keys and idempotent authenticated production receipt issuance.

**Architecture:** Raw 256-bit API keys are shown once and resolved through a peppered HMAC lookup hash. Pre-auth IP throttling protects invalid-key traffic; post-auth key/account limits and an idempotency store protect issuance. The existing claim-token creation logic moves into a provider-neutral issuer service shared by v1 and later adapters.

**Tech Stack:** TypeScript, Next.js, Prisma/Postgres, Vitest, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Raw API keys are random 256-bit values, displayed once, never logged or stored.
- Prefixes distinguish `rl_live_` from `rl_test_`; Session 2 enables production keys and reserves test keys for Session 3.
- Key capabilities are merchant/account/location/environment scoped.
- Idempotency reuse with identical request hash returns the original response; different payload returns 409.
- Authenticated production issuance creates `MERCHANT_VERIFIED`; anonymous/demo issuance remains `UNVERIFIED` and local-only.

---

### Task 1: API-key and idempotency persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821221000_add_merchant_api_keys/migration.sql`
- Create: `src/lib/merchant/api-key-store.ts`
- Create: `src/lib/merchant/api-key-store.test.ts`

**Interfaces:**
- Produces: `MerchantApiKey`, `MerchantIdempotencyRecord`, `issueApiKey`, `authenticateApiKey`, `rotateApiKey`, and `revokeApiKey`.

- [ ] **Step 1: Write failing key-lifecycle tests**

```ts
const issued = await issueApiKey(actor.id, account.id, { environment: "PRODUCTION", scopes: ["receipts.write"] });
expect(issued.secret).toMatch(/^rl_live_/);
expect(JSON.stringify(await storedKey(issued.id))).not.toContain(issued.secret);
expect(await authenticateApiKey(issued.secret)).toMatchObject({ accountId: account.id });
await revokeApiKey(actor.id, account.id, issued.id);
await expect(authenticateApiKey(issued.secret)).rejects.toThrow(InvalidApiKeyError);
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/merchant/api-key-store.test.ts`

Expected: FAIL because key models/store are absent.

- [ ] **Step 3: Implement peppered HMAC lookup and one-time return**

```ts
export function apiKeyLookupHash(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}
```

Require `MERCHANT_API_KEY_PEPPER` in deployed environments, store prefix/hash/scopes/expiry/revocation/rotation lineage, and use timing-safe comparisons for candidate hashes. Add unique `(accountId, environment, idempotencyKey)` plus request hash/response JSON.

- [ ] **Step 4: Generate, test, and commit**

Run: `npm run db:generate`

Run: `npm test -- src/lib/merchant/api-key-store.test.ts`

Run: `npm run check:migrations`

```bash
git add prisma src/lib/merchant/api-key-store.ts src/lib/merchant/api-key-store.test.ts
git commit -m "feat: add revocable merchant API keys"
```

### Task 2: Canonical merchant receipt issuer and idempotency

**Files:**
- Create: `src/lib/merchant/receipt-issuer.ts`
- Create: `src/lib/merchant/receipt-issuer.test.ts`
- Modify: `src/app/api/merchant/receipts/route.ts`
- Modify: `src/app/api/merchant/receipts/route.test.ts`

**Interfaces:**
- Produces: `issueMerchantReceipt(principal, payload, idempotencyKey)` returning stable `receiptId`, claim token/expiry, and claim URLs.

- [ ] **Step 1: Write failing idempotency and authority tests**

```ts
const first = await issueMerchantReceipt(principal, payload, "order-42");
const replay = await issueMerchantReceipt(principal, payload, "order-42");
expect(replay).toEqual(first);
await expect(issueMerchantReceipt(principal, changedPayload, "order-42")).rejects.toThrow(IdempotencyConflictError);
expect((await receipt(first.receiptId)).verification).toBe("MERCHANT_VERIFIED");
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/merchant/receipt-issuer.test.ts src/app/api/merchant/receipts/route.test.ts`

Expected: FAIL because the issuer and authenticated principal are absent.

- [ ] **Step 3: Extract transactional issuance and keep demo semantics separate**

```ts
export type MerchantPrincipal = {
  accountId: string;
  merchantId: string;
  keyId: string;
  environment: "PRODUCTION" | "SANDBOX";
  scopes: string[];
};
```

Hash canonical validated request JSON, reserve idempotency transactionally, create only against the principal's Merchant/location, and persist the stable response. Keep old local simulator routed through an explicit demo wrapper that forces `UNVERIFIED`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/merchant/receipt-issuer.test.ts src/app/api/merchant/receipts/route.test.ts`

Expected: PASS including concurrent identical requests creating one receipt.

```bash
git add src/lib/merchant/receipt-issuer.ts src/lib/merchant/receipt-issuer.test.ts src/app/api/merchant/receipts
git commit -m "feat: issue idempotent merchant-verified receipts"
```

### Task 3: v1 authentication, rate limits, and route contract

**Files:**
- Create: `src/lib/merchant/api-auth.ts`
- Create: `src/lib/merchant/api-auth.test.ts`
- Create: `src/app/api/v1/merchant/receipts/route.ts`
- Create: `src/app/api/v1/merchant/receipts/route.test.ts`
- Modify: `src/lib/rate-limit/index.ts`
- Modify: `src/lib/rate-limit/policy.ts`
- Modify: `src/lib/rate-limit/rate-limit.test.ts`
- Modify: `src/lib/validation.ts`

**Interfaces:**
- Produces: `authenticateMerchantRequest(request)` and `POST /api/v1/merchant/receipts`.

- [ ] **Step 1: Write failing auth/rate/route tests**

```ts
expect((await POST(requestWithoutBearer())).status).toBe(401);
expect((await POST(requestWithRevokedKey())).status).toBe(401);
expect((await POST(requestWithKeyAndIdempotency())).status).toBe(201);
expect(subjectForValidKey).toBe(`merchant-key:${key.id}`);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/merchant/api-auth.test.ts src/app/api/v1/merchant/receipts/route.test.ts src/lib/rate-limit/rate-limit.test.ts`

Expected: FAIL because merchant-key subjects and v1 route are absent.

- [ ] **Step 3: Implement two-stage throttling and exact headers**

Apply 60 invalid-auth attempts/hour/IP before key resolution, then 120 receipt creates/minute/key and 1,000/hour/account. Require the `Authorization` header with the caller's API key as its Bearer value and an `Idempotency-Key` of 8–128 visible ASCII characters. Return `WWW-Authenticate`, `Retry-After`, and safe structured errors without key prefixes beyond the stored display prefix.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/merchant/api-auth.test.ts src/app/api/v1/merchant/receipts/route.test.ts src/lib/rate-limit/rate-limit.test.ts`

Expected: PASS.

```bash
git add src/lib/merchant/api-auth.ts src/lib/merchant/api-auth.test.ts src/app/api/v1 src/lib/rate-limit src/lib/validation.ts
git commit -m "feat: authenticate the v1 merchant receipt API"
```

### Task 4: Key lifecycle dashboard and production configuration

**Files:**
- Create: `src/app/api/merchant/accounts/[accountId]/keys/route.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/keys/[keyId]/route.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/keys/route.test.ts`
- Modify: `src/app/merchant/merchant-dashboard.tsx`
- Create: `src/app/merchant/api-keys.tsx`
- Create: `src/app/merchant/api-keys.test.tsx`
- Modify: `src/lib/deployment.ts`
- Modify: `src/app/api/health/route.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing one-time-secret and config tests**

```tsx
await user.click(screen.getByRole("button", { name: /create production key/i }));
expect(await screen.findByText(/^rl_live_/)).toBeVisible();
await user.click(screen.getByRole("button", { name: /dismiss/i }));
expect(screen.queryByText(/^rl_live_/)).toBeNull();
expect(missingProductionConfig(envWithoutPepper)).toContain("MERCHANT_API_KEY_PEPPER");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/app/api/merchant/accounts src/app/merchant/api-keys.test.tsx src/lib/deployment.test.ts`

Expected: FAIL because key UI/routes/config gate are absent.

- [ ] **Step 3: Implement role-gated create/rotate/revoke UI**

Only OWNER/ADMIN/DEVELOPER may manage keys. Return raw secret only from successful create/rotate response, require typed confirmation for revocation, and show prefix/scopes/created/last-used/expiry/revoked metadata thereafter.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/app/api/merchant/accounts src/app/merchant/api-keys.test.tsx src/lib/deployment.test.ts`

Expected: PASS.

```bash
git add src/app/api/merchant/accounts src/app/merchant src/lib/deployment.ts src/app/api/health/route.ts .env.example
git commit -m "feat: manage merchant API key lifecycle"
```

### Task 5: Full verification and session evidence

**Files:**
- Modify: `README.md`
- Modify: `DEPLOYMENT.md`
- Modify: `ROADMAP.md`
- Modify: `RECEIPTLESS_STATE.md`
- Modify: `scripts/generate-progress-svg.mjs`
- Modify: `docs/progress.svg`

- [ ] **Step 1: Run full checks**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

- [ ] **Step 2: Verify one production-format request locally**

Create a key, issue the same payload twice with one idempotency key, verify one receipt/claim token, rotate the key, and prove the old key is rejected.

- [ ] **Step 3: Update state/progress and commit**

```bash
git add README.md DEPLOYMENT.md ROADMAP.md RECEIPTLESS_STATE.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record authenticated merchant API completion"
```
