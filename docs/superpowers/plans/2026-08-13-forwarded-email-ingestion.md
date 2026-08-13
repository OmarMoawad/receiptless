# Forwarded Email Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Receiptless user an opaque Postmark forwarding address that imports forwarded receipt emails into their own vault exactly once.

**Architecture:** A Postmark-only adapter normalizes provider JSON into a provider-neutral email type. A transactional ingestion service resolves the mailbox token, parses bounded plain text with the existing receipt heuristic, and persists an owner-scoped imported Receipt plus an idempotency record.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Prisma/Postgres, Zod, Vitest.

## Global Constraints

- Postmark is the first provider, but receipt parsing and persistence must not depend on Postmark field names.
- Imported receipts use `source=EMAIL` and `verification=IMPORTED`; inbound content cannot select an owner or upgrade authenticity.
- Webhook protection uses environment-managed HTTP Basic credentials; secrets never enter git.
- Unknown aliases and duplicate deliveries are acknowledged without disclosing account existence or creating receipts.
- Attachments, OAuth mailbox scanning, retailer adapters, and real DNS/provider activation are out of scope.

---

### Task 1: Per-user forwarding identity

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260813143000_add_inbound_email_ingestion/migration.sql`
- Create: `src/lib/inbound-email-address.ts`
- Create: `src/app/api/email/forwarding-address/route.ts`
- Create: `src/app/api/email/forwarding-address/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getOrCreateInboundEmailAddress(userId: string): Promise<{ mailboxToken: string }>`
- Produces: `formatForwardingAddress(baseAddress: string, mailboxToken: string): string`
- Produces: authenticated `GET /api/email/forwarding-address -> { address: string }`

- [ ] **Step 1: Write failing route tests**

Cover unauthenticated 401, stable repeated address for one user, distinct opaque addresses for two users, plus-address formatting, and 503 when `POSTMARK_INBOUND_ADDRESS` is absent. Use `registerTestUser()` and direct `GET(new NextRequest(...))` calls.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/app/api/email/forwarding-address/route.test.ts`

Expected: FAIL because the route and address model do not exist.

- [ ] **Step 3: Add the schema and migration**

Add:

```prisma
model InboundEmailAddress {
  id           String   @id @default(cuid())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId       String   @unique
  mailboxToken String   @unique
  createdAt    DateTime @default(now())
}
```

Add `inboundEmailAddress InboundEmailAddress?` to `User`. Write the matching SQL migration at the exact path above, run `npm run db:generate` to refresh the Prisma client, and inspect the SQL before applying it in the test database.

- [ ] **Step 4: Implement address creation and formatting**

Generate `randomBytes(18).toString("base64url")`, create lazily, and recover from a concurrent unique-user insert by reading the winner. Format `local+token@domain`, rejecting a malformed base address.

- [ ] **Step 5: Implement the authenticated route and verify GREEN**

Read the session through `getCurrentUser`, require `POSTMARK_INBOUND_ADDRESS`, and return the formatted address. Run the focused test until it passes, then run `npm run typecheck`.

- [ ] **Step 6: Commit Task 1**

```bash
git add prisma .env.example src/lib/inbound-email-address.ts src/app/api/email/forwarding-address
git commit -m "feat: add per-user receipt forwarding addresses"
```

### Task 2: Provider-neutral normalization and receipt parsing

**Files:**
- Create: `src/lib/inbound-email.ts`
- Create: `src/lib/postmark-inbound.ts`
- Create: `src/lib/postmark-inbound.test.ts`
- Create: `src/lib/email-receipt-parser.ts`
- Create: `src/lib/email-receipt-parser.test.ts`

**Interfaces:**
- Produces: `InboundEmail = { provider: "postmark"; providerMessageId: string; mailboxToken: string; from: string; subject: string | null; text: string }`
- Produces: `normalizePostmarkInbound(input: unknown): InboundEmail`
- Produces: `parseEmailReceipt(email: InboundEmail): { merchant: string; totalMinor: number; currency: string; purchasedAt: Date; items: Array<{ name: string; quantity: number; unitPriceMinor: number; totalPriceMinor: number }> }`

- [ ] **Step 1: Write failing adapter tests**

Test required `MessageID`/`MailboxHash`, `TextBody` preference, bounded HTML-to-text fallback that removes script/style content, common entity decoding, and maximum normalized body length.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `npm test -- src/lib/postmark-inbound.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement minimal normalization and verify GREEN**

Use a strict Zod schema for the subset of Postmark fields consumed. Keep HTML conversion pure and non-rendering. Run the focused test.

- [ ] **Step 4: Write failing email parser tests**

Test a forwarded receipt with merchant/items/total, subject/body noise, missing currency defaulting to USD, missing merchant defaulting to `Unknown merchant`, missing total defaulting to zero, and item conversion where quantity is 1 and unit/total minor values equal the parsed line price.

- [ ] **Step 5: Run parser tests and verify RED**

Run: `npm test -- src/lib/email-receipt-parser.test.ts`

Expected: FAIL because `parseEmailReceipt` does not exist.

- [ ] **Step 6: Implement parsing and verify GREEN**

Call `parseReceiptText(email.text)`. Use only its bounded suggestions and conservative defaults; do not infer verification. Run both new test files and `npm run typecheck`.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/lib/inbound-email.ts src/lib/postmark-inbound.ts src/lib/postmark-inbound.test.ts src/lib/email-receipt-parser.ts src/lib/email-receipt-parser.test.ts
git commit -m "feat: normalize and parse forwarded receipt emails"
```

### Task 3: Idempotent inbound webhook transaction

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/20260813143000_add_inbound_email_ingestion/migration.sql`
- Create: `src/lib/inbound-email-ingestion.ts`
- Create: `src/lib/inbound-email-ingestion.test.ts`
- Create: `src/app/api/webhooks/email/postmark/route.ts`
- Create: `src/app/api/webhooks/email/postmark/route.test.ts`

**Interfaces:**
- Produces: `ingestInboundEmail(email: InboundEmail): Promise<{ status: "created"; receiptId: string } | { status: "duplicate" | "unknown-mailbox" }>`
- Produces: `POST /api/webhooks/email/postmark`

- [ ] **Step 1: Write failing ingestion-service tests**

Test correct owner routing, `EMAIL`/`IMPORTED`, normalized bounded `rawPayload`, items, duplicate provider/message ID idempotency, unknown mailbox, and an existing Merchant's website remaining unchanged.

- [ ] **Step 2: Run ingestion tests and verify RED**

Run: `npm test -- src/lib/inbound-email-ingestion.test.ts`

Expected: FAIL because the delivery model and service do not exist.

- [ ] **Step 3: Add delivery idempotency schema**

Add `InboundEmailDelivery` with `provider`, `providerMessageId`, `userId`, nullable `receiptId`, timestamps, `@@unique([provider, providerMessageId])`, and cascading user relation. Keep the receipt relation nullable until the transaction completes.

- [ ] **Step 4: Implement the transaction and verify GREEN**

Use `prisma.$transaction`, resolve ownership only by mailbox token, create the unique delivery reservation, upsert Merchant with `update: {}`, create the imported Receipt, and attach the receipt ID. Convert the specific unique-delivery conflict into `duplicate`.

- [ ] **Step 5: Write failing webhook tests**

Test missing/wrong Basic auth returns 403, valid auth creates once, retry returns 200 without a duplicate, unknown mailbox returns 200 with an ignored status, and malformed authenticated JSON/payload returns 400.

- [ ] **Step 6: Run webhook tests and verify RED**

Run: `npm test -- src/app/api/webhooks/email/postmark/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 7: Implement constant-time Basic auth and route handling**

Parse `Authorization: Basic ...`, compare SHA-256 digests of supplied and configured credentials with `timingSafeEqual`, normalize the payload, call ingestion, and map results to non-disclosing responses.

- [ ] **Step 8: Verify Task 3 GREEN**

Run:

```bash
npm test -- src/lib/inbound-email-ingestion.test.ts src/app/api/webhooks/email/postmark/route.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit Task 3**

```bash
git add prisma src/lib/inbound-email-ingestion.ts src/lib/inbound-email-ingestion.test.ts src/app/api/webhooks/email/postmark
git commit -m "feat: ingest Postmark receipt webhooks idempotently"
```

### Task 4: Documentation, state, and full verification

**Files:**
- Modify: `README.md`
- Modify: `RECEIPTLESS_STATE.md`
- Modify: `docs/progress.svg`

**Interfaces:**
- Produces: reproducible Postmark setup instructions and honest Session 6 status.

- [ ] **Step 1: Document activation and limitations**

Document the base inbound address, Basic-auth webhook URL configuration, custom-domain/DNS step, local curl fixture, optional deployment IP allowlisting, ignored attachments, and the fact that real provider click-through remains pending.

- [ ] **Step 2: Update living memory and progress**

Mark Session 6 code complete with test counts and exact verification evidence, while preserving the separate real-domain/Postmark activation gap. Run `node scripts/generate-progress-svg.mjs` if the project's progress rules count Session 6 as completed.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0 with no test failures, type errors, lint errors, build errors, or whitespace errors.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md RECEIPTLESS_STATE.md docs/progress.svg
git commit -m "docs: record forwarded email ingestion session"
```
