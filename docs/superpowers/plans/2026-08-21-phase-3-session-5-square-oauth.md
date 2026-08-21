# Phase 3 Session 5 Square Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant administrator connect Square securely and map Square merchants/locations to Receiptless merchant accounts/locations.

**Architecture:** A provider-neutral POS connection service owns encrypted tokens and mapping invariants; Square is the first OAuth/client adapter. Single-use state binds callbacks to the authenticated merchant account/session, and external IDs—not display names—establish authority.

**Tech Stack:** TypeScript, Next.js, Prisma/Postgres, Square OAuth/REST APIs, AES-256-GCM token storage, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-3-merchant-api-sdk-design.md`

## Global Constraints

- Requested Square scopes are exactly `MERCHANT_PROFILE_READ`, `ORDERS_READ`, and `PAYMENTS_READ` unless official API testing proves an additional read scope mandatory.
- OAuth state is random, single-use, expiring, and bound to User session plus MerchantAccount.
- Square access/refresh credentials are encrypted at rest and never returned to browsers or logs.
- Mapping uses Square merchant/location IDs; display-name matching cannot authorize data.
- Production and sandbox Square credentials/endpoints remain separate.

---

### Task 1: POS connection, OAuth challenge, and location mapping schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821224000_add_pos_connections/migration.sql`
- Create: `src/lib/pos/pos-schema.test.ts`
- Modify: `src/lib/deployment.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `PosConnection`, `PosOAuthChallenge`, `PosLocationMapping`, provider/environment/status enums.

- [ ] **Step 1: Write failing schema/config tests**

```ts
expect(models).toContain("PosConnection");
expect(migration).toContain('UNIQUE ("provider", "providerMerchantId", "environment")');
expect(missingProductionConfig(partialSquareEnv)).toContain("SQUARE_CLIENT_SECRET");
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/pos/pos-schema.test.ts src/lib/deployment.test.ts`

Expected: FAIL because POS models/config validation are absent.

- [ ] **Step 3: Add additive models and all-or-none configuration validation**

```prisma
model PosConnection {
  id String @id @default(cuid())
  accountId String
  provider String
  environment String
  providerMerchantId String
  encryptedTokenData String
  status String @default("CONNECTED")
  @@unique([provider, providerMerchantId, environment])
}
```

Add connection/account indexes, expiring challenge uniqueness, mapping uniqueness on provider location and Receiptless location, and cascade/restrict behavior that preserves receipt provenance.

- [ ] **Step 4: Generate, test, and commit**

Run: `npm run db:generate`

Run: `npm test -- src/lib/pos/pos-schema.test.ts src/lib/deployment.test.ts`

Run: `npm run check:migrations`

```bash
git add prisma src/lib/pos/pos-schema.test.ts src/lib/deployment.ts .env.example
git commit -m "feat: add POS connection persistence"
```

### Task 2: Square OAuth/client adapter and token encryption

**Files:**
- Create: `src/lib/pos/types.ts`
- Create: `src/lib/pos/token-crypto.ts`
- Create: `src/lib/pos/token-crypto.test.ts`
- Create: `src/lib/pos/square-client.ts`
- Create: `src/lib/pos/square-client.test.ts`

**Interfaces:**
- Produces: `PosProviderClient` and Square methods `authorizationUrl`, `exchangeCode`, `refreshToken`, `revokeToken`, `getMerchant`, `listLocations`.

- [ ] **Step 1: Write failing OAuth/crypto contract tests**

```ts
expect(client.authorizationUrl(challenge).searchParams.get("scope")).toBe("MERCHANT_PROFILE_READ ORDERS_READ PAYMENTS_READ");
expect(decryptTokenData(encryptTokenData(tokens))).toEqual(tokens);
expect(JSON.stringify(encrypted)).not.toContain(tokens.accessToken);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/pos/token-crypto.test.ts src/lib/pos/square-client.test.ts`

Expected: FAIL because clients/crypto are absent.

- [ ] **Step 3: Implement pinned Square endpoints and safe responses**

```ts
export interface PosProviderClient {
  authorizationUrl(challenge: OAuthChallengeInput): URL;
  exchangeCode(code: string): Promise<PosTokenData>;
  refreshToken(refreshToken: string): Promise<PosTokenData>;
  revokeToken(accessToken: string): Promise<void>;
  getMerchant(accessToken: string): Promise<ProviderMerchant>;
  listLocations(accessToken: string): Promise<ProviderLocation[]>;
}
```

Use AES-256-GCM with a deployment key and random nonce, abort/timeouts, safe error codes, and response fixtures from official Square shapes. Do not log authorization codes, tokens, response bodies, or callback query strings.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/pos/token-crypto.test.ts src/lib/pos/square-client.test.ts`

```bash
git add src/lib/pos
git commit -m "feat: add secure Square OAuth client"
```

### Task 3: Connection service, callback replay protection, and mappings

**Files:**
- Create: `src/lib/pos/connection-service.ts`
- Create: `src/lib/pos/connection-service.test.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/pos/square/start/route.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/pos/square/start/route.test.ts`
- Create: `src/app/api/merchant/pos/square/callback/route.ts`
- Create: `src/app/api/merchant/pos/square/callback/route.test.ts`
- Create: `src/app/api/merchant/accounts/[accountId]/pos/mappings/route.ts`

**Interfaces:**
- Produces: `startPosConnection`, `completePosConnection`, `mapPosLocation`, `disconnectPosConnection`.

- [ ] **Step 1: Write failing state/isolation/mapping tests**

```ts
const started = await startPosConnection(actor.id, session.id, account.id, "SQUARE_SANDBOX");
await completePosConnection(started.state, "code");
await expect(completePosConnection(started.state, "code")).rejects.toThrow(OAuthStateConsumedError);
await expect(mapPosLocation(other.id, account.id, providerLocationId, localLocationId)).rejects.toThrow(MerchantNotFoundError);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/lib/pos/connection-service.test.ts src/app/api/merchant/pos/square/callback/route.test.ts`

Expected: FAIL because connection lifecycle is absent.

- [ ] **Step 3: Implement atomic state consumption and explicit mapping**

Consume state before code exchange inside a guarded transaction, bind callback to account/acting user/session audit metadata, verify returned Square merchant identity, store encrypted tokens, fetch locations, and require admin-selected mappings. Disconnect revokes remotely first when possible and marks local status disconnected even if remote revocation returns already-revoked.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/pos/connection-service.test.ts src/app/api/merchant/accounts/[accountId]/pos src/app/api/merchant/pos/square/callback/route.test.ts`

```bash
git add src/lib/pos/connection-service.ts src/lib/pos/connection-service.test.ts src/app/api/merchant
git commit -m "feat: connect and map Square merchant locations"
```

### Task 4: Square connection dashboard

**Files:**
- Create: `src/app/merchant/square-connection.tsx`
- Create: `src/app/merchant/square-connection.test.tsx`
- Modify: `src/app/merchant/merchant-dashboard.tsx`

- [ ] **Step 1: Write failing connect/map/disconnect UI tests**

```tsx
expect(screen.getByRole("button", { name: /connect square sandbox/i })).toBeVisible();
await user.selectOptions(screen.getByLabelText(/square location/i), "provider-location-1");
await user.click(screen.getByRole("button", { name: /save mapping/i }));
expect(await screen.findByText(/mapped/i)).toBeVisible();
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- src/app/merchant/square-connection.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement role-aware connection/mapping states**

Show disconnected/connecting/connected/needs-reauth/error, environment, scopes, provider merchant ID suffix, location mapping completeness, and explicit disconnect confirmation. Never render tokens or authorization codes.

- [ ] **Step 4: Run test and commit**

Run: `npm test -- src/app/merchant/square-connection.test.tsx`

```bash
git add src/app/merchant
git commit -m "feat: add Square connection workspace"
```

### Task 5: Full verification and session evidence

- [ ] **Step 1: Run all automated checks**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run check:migrations`

- [ ] **Step 2: Complete Square sandbox OAuth and mapping**

Authorize the Square sandbox seller, map one sandbox location, refresh once, disconnect/reconnect, and verify logs/telemetry contain no callback code/token.

- [ ] **Step 3: Update setup/deployment/state/progress and commit**

```bash
git add README.md .env.example DEPLOYMENT.md docs/SETUP-ACCOUNTS.md ROADMAP.md RECEIPTLESS_STATE.md scripts/generate-progress-svg.mjs docs/progress.svg
git commit -m "docs: record Square OAuth verification"
```
