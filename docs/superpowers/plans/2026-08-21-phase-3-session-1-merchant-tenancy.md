# Phase 3 Session 1 Merchant Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish merchant accounts, role-based administration, and locations without weakening consumer-vault isolation.

**Architecture:** `MerchantAccount` is a one-to-one administrative boundary around a newly created canonical `Merchant`; existing Users become merchant members through roles. A service owns all membership/location authorization, and thin authenticated routes/dashboard components call that service.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma/Postgres, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- One merchant account owns one newly created canonical Merchant; existing imported merchants cannot be claimed by name.
- Roles are exactly `OWNER`, `ADMIN`, `DEVELOPER`, and `VIEWER`.
- Existing User authentication is reused; no second password/token system is introduced.
- Every merchant query and mutation is account- and membership-scoped; consumer receipt ownership is unchanged.
- Schema changes are additive and migration safety must pass.

---

### Task 1: Merchant account, membership, location, and audit schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821220000_add_merchant_tenancy/migration.sql`
- Create: `src/lib/merchant/merchant-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `MerchantAccount`, `MerchantMembership`, `MerchantLocation`, `MerchantAuditEvent` and enum `MerchantRole`.

- [ ] **Step 1: Write failing schema/migration tests**

```ts
expect(models).toContain("MerchantAccount");
expect(models).toContain("MerchantMembership");
expect(migration).toContain('UNIQUE ("merchantId")');
expect(migration).toContain('UNIQUE ("accountId", "userId")');
expect(migration).toContain("merchant_audit_events_append_only");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/merchant/merchant-schema.test.ts`

Expected: FAIL because the models/migration are absent.

- [ ] **Step 3: Add additive models and indexes**

```prisma
enum MerchantRole { OWNER ADMIN DEVELOPER VIEWER }

model MerchantAccount {
  id         String @id @default(cuid())
  merchantId String @unique
  merchant   Merchant @relation(fields: [merchantId], references: [id])
  createdAt  DateTime @default(now())
  memberships MerchantMembership[]
  locations   MerchantLocation[]
}
```

Add role/membership uniqueness, location external/display fields, and audit rows with account/time indexes. Add database triggers that reject audit-event UPDATE/DELETE operations, and add reverse relations to User and Merchant.

- [ ] **Step 4: Generate client, run migration checks, and commit**

Run: `npm run db:generate`

Run: `npm test -- src/lib/merchant/merchant-schema.test.ts`

Run: `npm run check:migrations`

```bash
git add prisma src/lib/merchant/merchant-schema.test.ts
git commit -m "feat: add merchant tenancy schema"
```

### Task 2: Merchant authorization and lifecycle service

**Files:**
- Create: `src/lib/merchant/types.ts`
- Create: `src/lib/merchant/authorization.ts`
- Create: `src/lib/merchant/service.ts`
- Create: `src/lib/merchant/service.test.ts`

**Interfaces:**
- Produces: `createMerchantAccount`, `listMerchantAccounts`, `requireMerchantRole`, `addMerchantMember`, `changeMerchantRole`, `removeMerchantMember`, `createMerchantLocation`, `updateMerchantLocation`.

- [ ] **Step 1: Write failing lifecycle/isolation tests**

```ts
const account = await createMerchantAccount(owner.id, { name: "Pilot Shop", website: "https://pilot.example" });
expect(await listMerchantAccounts(other.id)).toEqual([]);
await expect(createMerchantLocation(other.id, account.id, input)).rejects.toThrow(MerchantNotFoundError);
expect(await auditTypes(account.id)).toEqual(["account.created", "location.created"]);
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/lib/merchant/service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement transactional creation and exact role matrix**

```ts
export const ROLE_CAPABILITIES = {
  OWNER: ["account.manage", "members.manage", "locations.manage", "keys.manage"],
  ADMIN: ["members.manage", "locations.manage", "keys.manage"],
  DEVELOPER: ["locations.read", "keys.manage"],
  VIEWER: ["locations.read"],
} as const;
```

Create Merchant, Account, OWNER membership, and audit event in one transaction. Reject duplicate global names with a user-safe conflict and never attach a pre-existing Merchant row.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/merchant/service.test.ts`

Expected: PASS including cross-account 404 semantics and last-owner protection.

```bash
git add src/lib/merchant
git commit -m "feat: enforce merchant roles and locations"
```

### Task 3: Merchant dashboard routes and UI

**Files:**
- Create: `src/app/api/merchant/accounts/route.ts`
- Create: `src/app/api/merchant/accounts/route.test.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/members/route.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/locations/route.ts`
- Create: `src/app/merchant/page.tsx`
- Create: `src/app/merchant/merchant-dashboard.tsx`
- Create: `src/app/merchant/merchant-dashboard.test.tsx`
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/rate-limit/policy.ts`

**Interfaces:**
- Produces: authenticated CRUD contracts for accounts, members, and locations; `/merchant` dashboard.

- [ ] **Step 1: Write failing route/UI tests**

```ts
expect((await POST_ACCOUNT(requestWithoutSession())).status).toBe(401);
expect((await POST_LOCATION(requestFor(viewer, account.id))).status).toBe(403);
expect(screen.getByRole("heading", { name: /merchant workspace/i })).toBeVisible();
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/app/api/merchant/accounts src/app/merchant/merchant-dashboard.test.tsx`

Expected: FAIL because routes/dashboard are absent.

- [ ] **Step 3: Implement thin authenticated routes and role-aware UI**

Validate names to 1–200 characters, websites as URLs, location IDs/names to 1–120 characters, and roles as the exact enum. Bodies never accept acting user IDs. Hide mutation controls for insufficient roles but retain server authorization as authority.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/app/api/merchant/accounts src/app/merchant/merchant-dashboard.test.tsx`

Expected: PASS.

```bash
git add src/app/api/merchant/accounts src/app/merchant src/lib/validation.ts src/lib/rate-limit/policy.ts
git commit -m "feat: add merchant administration workspace"
```

### Task 4: Session verification and roadmap state

**Files:**
- Modify: `README.md`
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

Expected: all exit 0.

- [ ] **Step 2: Browser-verify account, role, and location isolation**

Create one merchant account, add a location, verify a second user cannot see it, and verify a VIEWER cannot mutate it.

- [ ] **Step 3: Record Session 1 evidence and commit**

```bash
git add README.md ROADMAP.md RECEIPTLESS_STATE.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record phase 3 merchant tenancy completion"
```
