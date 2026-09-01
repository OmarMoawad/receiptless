# Phase 3 Session 4 Signed Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the receipt authenticity ladder cryptographically meaningful through merchant-held Ed25519 keys and verifiable canonical receipt attestations.

**Architecture:** RFC 8785 canonical bytes are hashed with SHA-256 and signed outside Receiptless. Registered public keys and immutable attestations are checked during issuance; only valid signatures produce `SIGNED`, while key status is evaluated when authenticity is displayed.

**Tech Stack:** TypeScript, Node WebCrypto/`crypto`, RFC 8785 canonicalization, Ed25519, Prisma/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Canonicalization version is `jcs-rfc8785-v1`; digest is SHA-256; signature algorithm is Ed25519.
- Merchant private keys never reach Receiptless storage, logs, telemetry, or API bodies except signatures.
- Invalid signatures are rejected, never silently downgraded.
- Normal key retirement preserves signatures made during validity; compromise is visibly reflected by effective authenticity.
- Signed fields include merchant/location/external receipt/idempotency identity, issued time, currency/money, and ordered line items.

---

### Task 1: Canonical envelope, digest, and cross-runtime vectors

**Files:**
- Create: `src/lib/merchant/signing/canonical-envelope.ts`
- Create: `src/lib/merchant/signing/verify.ts`
- Create: `src/lib/merchant/signing/verify.test.ts`
- Create: `docs/api/fixtures/signed-receipt-v1.json`
- Modify: `packages/receiptless-sdk/package.json`
- Create: `packages/receiptless-sdk/src/signing.ts`
- Create: `packages/receiptless-sdk/src/signing.test.ts`

**Interfaces:**
- Produces: `canonicalReceiptEnvelope`, `receiptDigest`, `verifyReceiptSignature`, and SDK `signReceipt`.

- [ ] **Step 1: Write failing deterministic-vector and tamper tests**

```ts
expect(bytesToHex(receiptDigest(fixture.payload))).toBe(fixture.sha256);
expect(verifyReceiptSignature(fixture.payload, fixture.signature, fixture.publicKey)).toBe(true);
expect(verifyReceiptSignature({ ...fixture.payload, totalMinor: 2 }, fixture.signature, fixture.publicKey)).toBe(false);
```

- [ ] **Step 2: Run app and SDK tests and verify failure**

Run: `npm test -- src/lib/merchant/signing/verify.test.ts`

Run: `npm test --workspace @receiptless/sdk -- signing.test.ts`

Expected: FAIL because canonicalization/signing modules are absent.

- [ ] **Step 3: Implement exact envelope and Ed25519 helpers**

```ts
export type SignedReceiptEnvelopeV1 = {
  version: "receiptless-receipt-v1";
  merchantAccountId: string;
  merchantLocationId: string;
  merchantReceiptId: string;
  idempotencyKey: string;
  issuedAt: string;
  currency: string;
  totalMinor: number;
  items: CanonicalSignedItem[];
};
```

Use an RFC 8785 implementation with pinned version, reject non-finite numbers/unknown fields, and verify fixture equality in both app and SDK.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/merchant/signing/verify.test.ts`

Run: `npm test --workspace @receiptless/sdk -- signing.test.ts`

```bash
git add src/lib/merchant/signing packages/receiptless-sdk docs/api/fixtures
git commit -m "feat: canonicalize and sign merchant receipts"
```

### Task 2: Public-key lifecycle and immutable attestations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821223000_add_receipt_signatures/migration.sql`
- Create: `src/lib/merchant/signing/key-service.ts`
- Create: `src/lib/merchant/signing/key-service.test.ts`

**Interfaces:**
- Produces: `registerSigningKey`, `retireSigningKey`, `markSigningKeyCompromised`, `resolveSigningKeyAt`.
- Produces: models `MerchantSigningKey` and `ReceiptAttestation`; adds `SIGNED` to `VerificationLevel`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
const key = await registerSigningKey(actor.id, account.id, { keyId: "2026-q3", publicKey, activeFrom });
expect(await resolveSigningKeyAt(account.id, "2026-q3", activeFrom)).toMatchObject({ id: key.id });
await retireSigningKey(actor.id, account.id, key.id, retiredAt);
expect(await resolveSigningKeyAt(account.id, "2026-q3", afterRetirement)).toBeNull();
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/merchant/signing/key-service.test.ts`

Expected: FAIL because models/service are absent.

- [ ] **Step 3: Add public-key validation and lifecycle rules**

Store public keys in SPKI/base64, enforce unique `(accountId,keyId)`, non-overlapping same-ID activation, immutable attestation digest/signature/version, and append-only lifecycle audit events. Compromise time cannot move later once recorded.

- [ ] **Step 4: Generate, test, and commit**

Run: `npm run db:generate`

Run: `npm test -- src/lib/merchant/signing/key-service.test.ts`

Run: `npm run check:migrations`

```bash
git add prisma src/lib/merchant/signing
git commit -m "feat: manage merchant signing public keys"
```

### Task 3: Signature verification during v1 issuance

**Files:**
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/merchant/receipt-issuer.ts`
- Modify: `src/lib/merchant/receipt-issuer.test.ts`
- Modify: `docs/api/openapi-v1.yaml`
- Modify: `src/lib/merchant/openapi-contract.test.ts`
- Modify: `packages/receiptless-sdk/src/types.ts`

**Interfaces:**
- Adds optional request `attestation: { keyId; algorithm: "Ed25519"; canonicalization: "jcs-rfc8785-v1"; signature }`.

- [ ] **Step 1: Write failing valid/invalid/rotated-key issuance tests**

```ts
expect((await issueMerchantReceipt(principal, signedPayload, key)).verification).toBe("SIGNED");
await expect(issueMerchantReceipt(principal, tamperedPayload, key)).rejects.toThrow(InvalidReceiptSignatureError);
await expect(issueMerchantReceipt(principal, payloadSignedAfterRetirement, key)).rejects.toThrow(SigningKeyInactiveError);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/merchant/receipt-issuer.test.ts src/lib/merchant/openapi-contract.test.ts`

Expected: FAIL because attestation input/verification is absent.

- [ ] **Step 3: Verify before persistence and atomically create attestation**

Build the server envelope from authenticated account/location and validated payload, verify exact digest/signature/key validity at `issuedAt`, then create receipt plus immutable attestation in one transaction. Unsigned authenticated calls remain `MERCHANT_VERIFIED`.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/merchant/receipt-issuer.test.ts src/lib/merchant/openapi-contract.test.ts`

```bash
git add src/lib/validation.ts src/lib/merchant docs/api/openapi-v1.yaml packages/receiptless-sdk/src/types.ts
git commit -m "feat: verify signed receipts at issuance"
```

### Task 4: Signing-key administration and consumer authenticity display

**Files:**
- Create: `src/app/api/merchant/accounts/[accountId]/signing-keys/route.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/signing-keys/[keyId]/route.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/signing-keys/route.test.ts`
- Create: `src/app/merchant/signing-keys.tsx`
- Create: `src/app/merchant/signing-keys.test.tsx`
- Modify: `src/app/receipts/[id]/page.tsx`
- Create: `src/lib/merchant/signing/effective-authenticity.ts`
- Create: `src/lib/merchant/signing/effective-authenticity.test.ts`

- [ ] **Step 1: Write failing role/UI/effective-status tests**

```ts
expect(effectiveAuthenticity(attestation, compromisedKey, receipt.purchasedAt)).toBe("SIGNED_KEY_COMPROMISED");
expect(screen.getByText(/cryptographically signed/i)).toBeVisible();
expect((await registerKeyAsViewer()).status).toBe(403);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/app/api/merchant/accounts src/app/merchant/signing-keys.test.tsx src/lib/merchant/signing/effective-authenticity.test.ts`

Expected: FAIL because routes/UI/effective status are absent.

- [ ] **Step 3: Implement public-key-only UI and proof language**

Allow OWNER/ADMIN/DEVELOPER registration/retirement and OWNER-only compromise marking. Receipt detail states `UNVERIFIED`, `IMPORTED`, `MERCHANT_VERIFIED`, `SIGNED`, or signed-key-compromised with exact proof explanation; it never displays signature/public-key blobs.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/app/api/merchant/accounts src/app/merchant/signing-keys.test.tsx src/lib/merchant/signing/effective-authenticity.test.ts`

```bash
git add src/app/api/merchant/accounts src/app/merchant src/app/receipts src/lib/merchant/signing
git commit -m "feat: surface cryptographic receipt authenticity"
```

### Task 5: Full verification and session evidence

- [ ] **Step 1: Run full automated checks**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

- [ ] **Step 2: Run the SDK signed-receipt journey**

Generate a local merchant keypair, register only the public key, sign and submit one sandbox receipt, prove tampering fails, retire the key, and verify the historical signature remains valid.

- [ ] **Step 3: Update API docs, `ROADMAP.md`, `RECEIPTLESS_STATE.md`, progress source/SVG, and commit**

```bash
git add README.md docs/api ROADMAP.md RECEIPTLESS_STATE.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record signed-receipt verification"
```
