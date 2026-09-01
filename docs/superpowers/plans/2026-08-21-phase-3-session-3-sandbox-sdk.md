# Phase 3 Session 3 Sandbox and SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a structurally isolated merchant sandbox, versioned OpenAPI contract, TypeScript SDK, and runnable developer onboarding path.

**Architecture:** Production and sandbox share validation/business logic but use separate persistence adapters and claim surfaces. OpenAPI 3.1 is checked against runtime schemas; a thin SDK consumes the public HTTP contract and never imports application internals.

**Tech Stack:** TypeScript, Next.js, Prisma/Postgres, OpenAPI 3.1, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Sandbox keys use `rl_test_`; sandbox rows live only in dedicated sandbox tables.
- Sandbox claims resolve only at `/sandbox/claim/:token` and never attach to a User.
- Production vault/search/report/export/claim queries cannot read sandbox tables.
- SDK retries only safe/idempotent operations and always sends caller-supplied idempotency keys.
- Registry publication is not performed without explicit owner approval.

---

### Task 1: Dedicated sandbox persistence and claim viewer

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821222000_add_merchant_sandbox/migration.sql`
- Create: `src/lib/merchant/sandbox-repository.ts`
- Create: `src/lib/merchant/sandbox-repository.test.ts`
- Create: `src/app/sandbox/claim/[token]/page.tsx`
- Create: `src/app/sandbox/claim/[token]/page.test.tsx`
- Modify: `src/lib/merchant/receipt-issuer.ts`

**Interfaces:**
- Produces: `MerchantReceiptRepository` with production and sandbox implementations.

- [ ] **Step 1: Write failing hard-isolation tests**

```ts
const issued = await issueMerchantReceipt(sandboxPrincipal, payload, "sandbox-42");
expect(await prisma.receipt.findUnique({ where: { id: issued.receiptId } })).toBeNull();
expect(await prisma.merchantSandboxReceipt.findUnique({ where: { id: issued.receiptId } })).not.toBeNull();
expect((await claimProduction(issued.claimToken)).status).toBe(404);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/merchant/sandbox-repository.test.ts src/app/sandbox/claim/[token]/page.test.tsx`

Expected: FAIL because sandbox tables/repository/viewer are absent.

- [ ] **Step 3: Add sandbox models and repository dispatch**

```ts
export interface MerchantReceiptRepository {
  issue(input: CanonicalMerchantReceipt, idempotency: IdempotencyInput): Promise<IssuedReceipt>;
  findClaim(tokenHash: string): Promise<SandboxClaimView | null>;
}
```

Persist sandbox merchant receipt/items/claim/idempotency separately, use hashed claim tokens, label every viewer page “Sandbox — not a real receipt,” and add expiry cleanup to maintenance.

- [ ] **Step 4: Generate, test, and commit**

Run: `npm run db:generate`

Run: `npm test -- src/lib/merchant/sandbox-repository.test.ts src/app/sandbox/claim/[token]/page.test.tsx`

Run: `npm run check:migrations`

```bash
git add prisma src/lib/merchant src/app/sandbox
git commit -m "feat: isolate merchant sandbox receipts"
```

### Task 2: OpenAPI v1 contract and runtime drift gate

**Files:**
- Create: `docs/api/openapi-v1.yaml`
- Create: `src/lib/merchant/openapi-contract.test.ts`
- Modify: `src/lib/validation.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: OpenAPI schemas `MerchantReceiptCreate`, `IssuedReceipt`, and `ApiError` matching runtime Zod input/output.

- [ ] **Step 1: Write failing contract parity test**

```ts
expect(validateWithOpenApi(validPayload)).toEqual({ valid: true });
expect(validateWithRuntime(validPayload).success).toBe(true);
expect(validateWithOpenApi({ ...validPayload, totalMinor: 1.5 }).valid).toBe(false);
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/merchant/openapi-contract.test.ts`

Expected: FAIL because the OpenAPI document is absent.

- [ ] **Step 3: Define complete request/response/error/security contract**

Document bearer auth, idempotency header, 201/200 replay, 400/401/403/409/429/500, integer money, 200-item cap, production/sandbox servers, and version/deprecation headers. The test samples boundary values through both validators.

- [ ] **Step 4: Run test and commit**

Run: `npm test -- src/lib/merchant/openapi-contract.test.ts`

Expected: PASS.

```bash
git add docs/api/openapi-v1.yaml src/lib/merchant/openapi-contract.test.ts src/lib/validation.ts .github/workflows/ci.yml
git commit -m "docs: define and verify merchant API v1"
```

### Task 3: TypeScript SDK package

**Files:**
- Modify: `package.json`
- Create: `packages/receiptless-sdk/package.json`
- Create: `packages/receiptless-sdk/tsconfig.json`
- Create: `packages/receiptless-sdk/src/index.ts`
- Create: `packages/receiptless-sdk/src/client.ts`
- Create: `packages/receiptless-sdk/src/types.ts`
- Create: `packages/receiptless-sdk/src/client.test.ts`

**Interfaces:**
- Produces: `ReceiptlessClient` and `createReceipt(input, { idempotencyKey })`.

- [ ] **Step 1: Write failing SDK request/error/retry tests**

```ts
const client = new ReceiptlessClient({ apiKey: "rl_test_secret", baseUrl: server.url, fetch });
const issued = await client.createReceipt(payload, { idempotencyKey: "order-42" });
expect(issued.claimUrlWeb).toContain("/sandbox/claim/");
await expect(client.createReceipt(payload, { idempotencyKey: "conflict" })).rejects.toMatchObject({ status: 409 });
```

- [ ] **Step 2: Run SDK test and verify failure**

Run: `npm test --workspace @receiptless/sdk`

Expected: FAIL because the workspace/package is absent.

- [ ] **Step 3: Implement dependency-light client and typed errors**

```ts
export class ReceiptlessClient {
  constructor(private readonly options: { apiKey: string; baseUrl: string; fetch?: typeof fetch }) {}
  createReceipt(input: MerchantReceiptCreate, options: { idempotencyKey: string }): Promise<IssuedReceipt>;
}
```

Set auth/content/idempotency headers, validate required options, parse structured errors, honor `Retry-After`, and retry network/429/5xx only because receipt creation is idempotent.

- [ ] **Step 4: Run SDK tests/typecheck and commit**

Run: `npm test --workspace @receiptless/sdk`

Run: `npm run typecheck --workspace @receiptless/sdk`

```bash
git add package.json packages/receiptless-sdk
git commit -m "feat: add the receiptless TypeScript SDK"
```

### Task 4: Developer quickstart and contract-level journey

**Files:**
- Create: `docs/api/quickstart.md`
- Create: `examples/typescript-create-receipt/package.json`
- Create: `examples/typescript-create-receipt/index.ts`
- Create: `src/lib/merchant/developer-journey.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing from-zero journey test**

The test starts the route handler with a test key, invokes only the built SDK, and asserts sandbox issuance/viewing; it must not import `src/lib/merchant/receipt-issuer.ts`.

Run: `npm test -- src/lib/merchant/developer-journey.test.ts`

Expected: FAIL because the SDK/example/quickstart are not wired.

- [ ] **Step 2: Write exact quickstart and runnable example**

```ts
const client = new ReceiptlessClient({ apiKey: process.env.RECEIPTLESS_API_KEY!, baseUrl: process.env.RECEIPTLESS_BASE_URL! });
console.log(await client.createReceipt(receipt, { idempotencyKey: `order:${receipt.externalId}` }));
```

Document key creation, curl and SDK requests, sandbox banner/expiry, errors, 429 behavior, rotation, production checklist, and v1 deprecation policy.

- [ ] **Step 3: Run journey and example typecheck**

Run: `npm test -- src/lib/merchant/developer-journey.test.ts`

Run: `npm run typecheck --workspace @receiptless/sdk`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/api examples README.md src/lib/merchant/developer-journey.test.ts
git commit -m "docs: add merchant sandbox quickstart"
```

### Task 5: Full verification and session evidence

- [ ] **Step 1: Run repository verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

- [ ] **Step 2: Run the example against the sandbox deployment**

Issue a test key, execute the example, open the sandbox claim URL, verify no production receipt/user attachment, revoke the key, and prove further calls fail.

- [ ] **Step 3: Update `ROADMAP.md`, `RECEIPTLESS_STATE.md`, progress source/SVG, and commit evidence**

```bash
git add ROADMAP.md RECEIPTLESS_STATE.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record sandbox and SDK verification"
```
