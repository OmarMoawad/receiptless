# Phase 3 Merchant API, SDK, Authenticity, and Pilot Design

## Status and Completion Boundary

The repository currently defines Phase 3 only as three roadmap outcomes and has no numbered sessions. This specification creates the phase cadence and testable acceptance criteria.

Phase 3 has eight sessions. Sessions 1–7 are independently buildable and end in a production-ready Square integration certified in Square's sandbox. Session 8 requires a genuine merchant-authorized POS purchase and is externally blocked because no live Square merchant is currently available. The phase must not be labelled complete until Session 8 produces that evidence. A sandbox transaction is not renamed a real pilot.

Phase 2 Session 8 completes first. Phase 3 then proceeds one session/branch/PR at a time from current `main`, never as stacked branches.

## Approaches Considered

The chosen approach is a first-party merchant platform with Square as the initial provider and Shopify as a merchant-driven fallback. It creates explicit merchant tenancy, a versioned public receipt API, a TypeScript SDK, merchant-held signing keys, and a provider-neutral POS ingestion boundary.

Alternatives rejected:

- Keeping the current environment-gated anonymous endpoint and adding a shared secret cannot provide merchant isolation, key lifecycle, or honest `MERCHANT_VERIFIED` semantics.
- Building directly around Square objects would make the canonical receipt contract provider-specific and make the advertised SDK misleading.
- Calling a sandbox integration the real pilot would change the roadmap's meaning rather than complete it.

## Session Cadence

### Session 1 — Merchant tenancy and administration

Add `MerchantAccount` as the administrative/security boundary for an existing `Merchant`, `MerchantMembership` linking current authenticated Users as owner/admin/developer/viewer, and `MerchantLocation`. Merchant administrators use the existing user authentication rather than a second password system. All merchant-dashboard queries and mutations require membership and role checks.

The current global merchant-name uniqueness remains a documented v1 limitation; a merchant account is one-to-one with a canonical Merchant, and locations represent branches. Session 1 creates a new canonical Merchant together with its account in one transaction. Existing imported merchants remain unowned and cannot be attached in Phase 3 merely by matching a name; reconciliation of an existing imported merchant requires a later evidence-backed administrative process. No caller can claim an arbitrary existing merchant.

Acceptance: additive migration, role matrix, cross-account isolation tests, audited account/location lifecycle, and no change to consumer receipt ownership.

### Session 2 — API keys and authenticated receipt issuance

Add environment-scoped API keys with random 256-bit secrets, visible once. Store only a short non-secret prefix and `HMAC-SHA-256(server pepper, secret)` lookup hash, plus scopes, creator, last-used time, expiry, rotation lineage, and revocation. Production and sandbox key prefixes are visibly different.

Introduce `/api/v1/merchant/receipts`. Invalid/missing credentials receive an IP-bound pre-authentication limit; valid credentials receive key- and merchant-bound limits. Limits protect abuse but are not used as billing counters. Keys authorize only their account, environment, scopes, and locations.

Production issuance is idempotent: the merchant supplies an idempotency key; the server stores request hash and response. Reuse with the same payload returns the original response, while reuse with a different payload returns conflict. Authenticated production issuance creates `MERCHANT_VERIFIED` receipts and claim tokens. The old anonymous simulator remains local-only under an explicitly named demo path and can create only `UNVERIFIED` data.

Acceptance: key create/rotate/revoke UI/API, isolation, scope/expiry/revocation checks, pre/post-auth rate limits, idempotency and concurrency tests, audit events, and removal of stale “unauthenticated/unrate-limited” claims.

### Session 3 — Sandbox, contract, developer docs, and TypeScript SDK

Sandbox calls exercise the same validation and issuance service but persist to dedicated sandbox receipt/item/claim/idempotency tables. Sandbox claim URLs resolve only through a visibly labelled `/sandbox/claim/:token` route into a disposable sandbox viewer; they cannot attach to a consumer User. Sandbox objects cannot appear in consumer vaults, reports, searches, exports, or production claim routes. This table-level separation avoids relying on every consumer query to remember an environment predicate.

Check in an OpenAPI 3.1 contract for v1 and verify it against the runtime Zod schemas in CI. Add a small TypeScript SDK package covering client construction, production/sandbox base URLs, idempotent receipt creation, claim response types, structured errors, retries only for safe/idempotent operations, and later signature helpers. Publish preparation is included; actual public registry publication waits for owner approval.

Developer documentation starts from zero: create account/location, issue a sandbox key, submit/claim a receipt, handle errors/429s, rotate a key, and move to production. A runnable example and contract test must complete the sandbox flow without importing application internals.

Acceptance: hard sandbox isolation tests, OpenAPI/runtime drift gate, SDK integration tests, examples, and documented version/deprecation policy.

### Session 4 — Cryptographic receipt authenticity

Use RFC 8785 JSON Canonicalization Scheme, SHA-256 payload digests, and Ed25519 detached signatures. The signed envelope includes canonicalization/signature versions, merchant account/location, merchant receipt ID, issued-at time, currency/money fields, line items, and the idempotency identity. Server-added claim and database identifiers are excluded.

Merchant private keys remain merchant-held. The SDK provides key generation/loading and signing helpers but never transmits or stores the private key at Receiptless. Merchants register public keys with a stable key ID. `MerchantSigningKey` records activation, rotation, revocation, and optional compromise time. `ReceiptAttestation` stores the canonical digest, signature, key, versions, verification time, and status.

Only a valid signature from an active key authorized for that merchant/location at issuance creates `SIGNED`. A valid authenticated but unsigned call remains `MERCHANT_VERIFIED`; invalid signatures are rejected rather than downgraded. Normal retirement preserves signatures made during the key's valid interval. A compromise event marks affected attestations visibly suspect according to the recorded compromise time; authenticity is derived from the attestation and key status rather than trusting the enum alone.

Acceptance: deterministic cross-runtime fixtures, tamper detection for every signed field, unknown/wrong/revoked/not-yet-active keys, rotation, compromise semantics, no private-key persistence/logging, and consumer UI showing what each verification level actually proves.

### Session 5 — Square connection and merchant/location mapping

Square is the first provider because its self-service sandbox supports OAuth, webhooks, orders, payments, merchants, and locations without a vendor partnership prerequisite. Add a provider-neutral `PosConnection` boundary with Square OAuth as the first adapter. Use least-privilege read scopes needed for merchant profile, orders, and completed payments.

OAuth state is single-use and bound to the acting merchant account and session. Access/refresh tokens are encrypted with deployment-specific key material, never exposed to the browser, and refreshed/revoked through the connection service. Square merchant/location IDs map explicitly to Receiptless account/location IDs; no display-name matching establishes authority.

Acceptance: sandbox OAuth, state replay/cross-account rejection, encrypted-token tests, scope checks, mapping UI, refresh/disconnect/revocation, and safe diagnostics.

### Session 6 — Square webhook ingestion and normalization

Validate `x-square-hmacsha256-signature` over the raw request body, notification URL, and subscription secret before parsing. Persist webhook delivery IDs for replay protection. Treat `payment.updated` with `COMPLETED` as a signal, then retrieve the associated payment/order and merchant/location from Square; webhook bodies are not the authoritative receipt record.

A provider adapter maps Square orders, line items, taxes, discounts, tenders, currency, timestamps, and location into the same canonical merchant receipt input used by v1. Provider object/version IDs become idempotency and provenance keys. Retries use bounded exponential backoff with jitter; per-event failure isolation and a reprocessing state prevent cursor advancement/data loss. Square-originated receipts are `MERCHANT_VERIFIED`; they are `SIGNED` only if the merchant separately supplies a valid merchant-held signature over the canonical envelope.

Acceptance: official-shape fixtures, signature rejection, replay/concurrency, completed/non-completed transitions, retrieval failures, duplicate updates, mapping isolation, money invariants, and one resulting claim-token flow in Square sandbox.

### Session 7 — Sandbox certification and pilot readiness

Run the complete Square sandbox journey: authorize account, map location, create a POS-originated order/payment, receive and validate webhook, retrieve/normalize order, create receipt, claim it into a consumer vault, and verify search/report/detail provenance. Capture reproducible evidence without secrets or customer data.

Add observability for OAuth, webhook validation, retrieval, normalization, idempotency, and claim delivery; alerts must use safe metadata. Complete a focused security review, migration/rollback rehearsal, rate-limit/load checks, token/key rotation drills, disconnect behavior, developer onboarding rehearsal, and a live-pilot/runback checklist.

Acceptance: all automated checks, real sandbox evidence, production configuration validation, docs/state/badge updates showing “pilot ready,” and no claim that Phase 3 itself is complete.

### Session 8 — Real Square merchant pilot and phase closure

This session begins only when a real Square merchant authorizes the production app. It requires merchant consent, production OAuth configuration, location mapping, one genuine POS purchase, webhook delivery, canonical receipt creation, customer claim, vault/report verification, error/log review, and merchant feedback. Test/refund handling must follow the merchant's procedures; no transaction is initiated without explicit human approval.

The phase closes only when the evidence is recorded and remaining pilot defects are resolved or explicitly accepted. With no current merchant, this session is `blocked_external`, not “done,” and the roadmap/progress artifact continues to show Phase 3 in progress.

## Shared Data and Security Boundaries

The phase adds focused tables rather than overloading consumer identities:

- merchant accounts, memberships, and locations;
- API keys, idempotency records, and append-only merchant audit events;
- dedicated sandbox receipts/items/claims;
- signing public keys and receipt attestations;
- POS connections, encrypted tokens, location mappings, webhook deliveries, and reprocessing state.

All credentials are redacted from logs, errors, telemetry, and API responses. API and webhook payload sizes/counts are bounded. Money remains integer minor units with known currency scales. Merchant input cannot mutate another account's canonical metadata or choose a consumer owner. Claims remain opaque, expiring, single-use, and atomically attached by the authenticated consumer.

Append-only audit events cover membership/role changes, key lifecycle, production issuance, public-key lifecycle, POS connection/mapping, webhook outcomes, and administrative reprocessing. Audit retention and deletion behavior are documented before production use.

## Phase-level Verification

Every session uses test-first implementation, isolated worktrees, one PR from current `main`, content-diff merge verification, additive migration review, and session-specific documentation/state/progress updates. Phase-level verification includes:

- unit, integration, contract, concurrency, tenant-isolation, crypto-vector, route, and browser tests;
- typecheck, lint, build, migration-safety, and dependency/security checks;
- sandbox/production separation and no-secret scans;
- Square sandbox certification in Session 7;
- live merchant evidence in Session 8.

The existing anonymous route, global merchant-name simplification, stale documentation counts, and contradictory phase labels are corrected only in the session that establishes their replacement and after verification.

## Explicit Non-goals

- Sponsorship configuration, printed receipts, terminal hardware, payments processing, merchant billing, App Marketplace publication, or multi-provider rollout.
- Shopify integration unless the eventual pilot merchant requires it; Shopify remains the documented fallback.
- Toast, which requires partnership approval before sandbox access, or Clover, whose production app requires review.
- Storing merchant private signing keys.
- Calling sandbox certification a real pilot or marking Phase 3 complete before Session 8.
