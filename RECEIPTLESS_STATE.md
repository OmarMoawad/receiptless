# receiptless State

**Read this file first, before anything else in this repo.** This is the
same resumability contract IDent's `IDent_STATE.md` uses (see its
`OPERATIONS.md` for the full rationale, in that repo's own root — not
reproduced here by absolute local path, since this file is public and
should read cold on any machine): the intended way to resume work here,
after a gap of any length, is one instruction — *"read the repository and
continue the currently approved roadmap"* — and if that doesn't work
without someone supplying context from memory first, this file is out of
date. That's a bug in this file, not a documentation nicety.

Last updated: 2026-08-11 — this file created, then revised same-day after
an external review of the initial version (see "Completed components" and
"Session cadence" below for what changed and why — short version: the
initial version overclaimed Phase 0 as "verified" with zero automated
tests behind that word, had a real contradiction about which session
finishes Phase 1's email-ingestion scope, and two concrete Phase-0 bugs
got fixed alongside the doc revision). Retroactively logs Phase 0
(ROADMAP.md) as done, and breaks Phase 1 into a **session-by-session
cadence** (below) instead of one big phase-sized task, so receiptless can be
worked in daily increments the same way IDent's Phase 0B has been — pick up
this file, do the next session, update it, commit, push.

## Current phase

**Phase 1 — Reliable ingestion + accounts** (ROADMAP.md), starting now.
Phase 0 (canonical foundation) is done — see "Completed components" below.

Phase 1 is one paragraph in ROADMAP.md but six real, multi-day pieces of
work (hosting, accounts, storage, OCR, email ingestion, parser adapters).
"Session cadence" below sequences them into 9 sessions (email ingestion
splits into two — forward-to-address, then the materially bigger OAuth
scan — and a testing/CI baseline is folded into Session 1 rather than left
implicit), each a coherent, testable, roughly one-day slice — mirroring
how IDent's sessions work, not ROADMAP.md's phase-sized granularity.

## Completed components (Phase 0 — manually exercised, not test-verified)

Unlike IDent's own "Completed components," this list is **not** backed by
an automated test suite yet — receiptless currently has `dev`/`build`/
`start`/`lint` scripts but no `test` or `typecheck` script and no CI
workflow. What's below was built and manually/curl-checked, the way
IDent's own Phase 0A infra was before it grew a real test suite — it's
real, working code, just not held to IDent's later, stronger bar of
"verified" yet. Session 1 below now explicitly includes closing that gap,
rather than leaving it implicit.

- `Merchant` / `Receipt` / `ReceiptItem` Prisma schema (`prisma/schema.prisma`)
  — integer minor-unit money throughout (no floats for currency), a
  `VerificationLevel` ladder (`UNVERIFIED` → `IMPORTED` → `MERCHANT_VERIFIED`,
  signature-based `SIGNED` is Phase 3), `ReceiptSource` enum covering every
  planned capture channel even though only QR/PHOTO/MANUAL are wired up yet.
- QR claim-token protocol: `POST /api/merchant/receipts` (`src/app/api/
  merchant/receipts/route.ts`) creates a receipt server-side and returns an
  opaque, expiring claim token — never raw receipt data in the QR image
  itself (`src/lib/claim.ts`). `GET /api/claim/[token]` +
  `src/app/claim/[token]/page.tsx` resolve it. Legacy inline QR payload
  parsing (`src/lib/parseReceipt.ts`'s `parseInlinePayload`) kept as a
  fallback for retailers who print a QR but haven't integrated the merchant
  API — this is also the seed Session 7 below builds real per-retailer
  adapters on.
- Zod validation at every API boundary (`src/lib/validation.ts`) — amount
  types, currency, dates, enum values, payload size, and the `data:image/*`
  URL contract photos currently use (see Session 4 below for why that's
  Phase 0-only, not a long-term design).
- `GET /api/search` — minimal vault search across merchant/item names.
- PWA capture (`src/components/QRScanner.tsx`, `ReceiptForm.tsx`,
  `SpendCharts.tsx`), monthly/annual dashboards (`/api/reports/{monthly,
  annual}`).
- SQLite dev database (`prisma/schema.prisma`'s `datasource db`) — Session 1
  below replaces this with Postgres, same infra move IDent made in its own
  Phase 0A.

No accounts exist yet — everything above is one shared, unauthenticated
vault. `/api/merchant/receipts` is explicitly unauthenticated, meant for
local/demo use only (see ROADMAP.md and the hard gate below).

**Two Phase-0 fixes applied same-day as this file's revision**, both found
by the external review mentioned in the header above:
- `.env.example` was never actually committed — `.gitignore`'s `.env*`
  pattern silently excluded it too, so the README's documented
  `cp .env.example .env` setup step was broken on a fresh clone (which
  matters now that this repo is public). Fixed: `!.env.example` added to
  `.gitignore`, the file committed.
- `POST /api/merchant/receipts` upserted `Merchant` and would update an
  **existing** merchant's `website` field from unauthenticated request
  input — since the endpoint has no merchant auth yet (by design, see
  above), anyone who knew a merchant name could overwrite that shared
  reference data. Fixed: `update` is now always `{}`; only a brand-new
  `Merchant` row gets a `website`, from its own creation payload. Revisit
  once Phase 3 merchant API keys exist.

## Session cadence for Phase 1 — work one per day, in order

Each session is scoped to be buildable, testable, and shippable in roughly
a day, the way IDent's sessions are — not "start Phase 1," but "do Session
N." Ordered so each one only depends on sessions before it, never after.
Sessions marked **needs Omar** have a real-world decision or account
creation blocking part of them — flagged explicitly rather than guessed at,
same convention IDent uses for its own hosting-target and click-through
gaps.

1. **Postgres migration + testing/CI baseline (infra only, no behavior
   change).** Two infra pieces bundled into one session because they're
   both prerequisites everything after this depends on, and because
   shipping a DB swap with zero automated coverage of it is exactly the
   "verified" overclaim this file got corrected on (see header):
   - Swap `prisma/schema.prisma`'s `datasource db` from `sqlite` to
     `postgresql`; add a `docker-compose.yml` for local Postgres, mirroring
     IDent's exact pattern (`receiptless-db` service, `db:generate`/
     `db:migrate` npm scripts). Regenerate the Prisma client, run a fresh
     migration. Zero schema *shape* changes — this is purely the storage
     swap everything after it assumes.
   - Add a real test runner (Vitest, matching IDent's stack) and a
     `typecheck` script; wire up a GitHub Actions workflow mirroring
     IDent's `.github/workflows/ci.yml` (Postgres service container,
     `npm install` → typecheck → `db:migrate` → test → build). First tests
     to write: claim-token issuance/resolution/expiry, double-claim
     rejection (409), malformed merchant payloads (400 via the existing
     Zod schemas), and the total/subtotal/tax/discount money-math helpers.
     This is the floor every later session's own tests build on — from
     Session 2 onward, "Completed components" entries should read like
     IDent's (test-backed), not like Phase 0's (manually exercised).

2. **User accounts: schema + register/login.** New `User` model
   (id, username or email, password hash, `createdAt`) — no AMK/vault-key
   concept needed here the way IDent has one, since receiptless isn't
   client-side E2E encrypted (see "Known open decisions" below for whether
   that should change later). `POST /api/auth/register`, `POST
   /api/auth/login`, session issuance. **Open decision to make explicitly
   before writing code, not improvise mid-session:** cookie-based session
   (same-origin Next.js app, simpler, more idiomatic here) vs. IDent's
   bearer-token pattern (only needed there because apps/web and apps/api
   are cross-origin). Recommend cookie-based for receiptless specifically —
   confirm before starting. No real UI polish yet, just working
   register/login forms and tests.

3. **Scope the vault to a user.** Add `ownerId` to `Receipt` (not to
   `Merchant` — a merchant is shared reference data across users, e.g.
   "Starbucks" is the same row for everyone). Every existing receipt-facing
   route (`/api/receipts`, `/api/search`, `/api/reports/*`) requires a
   session and scopes its query by `ownerId`. The claim-token flow gets a
   natural extension instead of a redesign: a merchant-pushed receipt is
   created with `ownerId: null` (unclaimed), and visiting `/claim/[token]`
   while logged in attaches `ownerId` at claim time. Make the attach step
   one atomic transaction, not two separate writes an interrupted request
   could split: verify the caller's session → look up the token where
   `claimedAt IS NULL` and not expired → in the same transaction, set
   `ownerId` to the caller and `claimedAt` to now → 409 if it was already
   claimed or the token doesn't resolve, same semantics `src/lib/claim.ts`
   already uses for the existing single-use check, just now also gated on
   authentication before the claim can complete. Tests: one user can never
   see another's receipts; the claim-and-attach flow works end to end;
   claiming an already-claimed token 409s regardless of which user asks.

4. **Real object storage for photos (S3/R2).** Replace the inline
   `data:image/*` URL storage (Phase 0's deliberate placeholder — see
   `validation.ts`'s comment on `imageUrlSchema`) with real uploads to
   S3/R2, storing only the object key/URL on `Receipt`. **Needs Omar**:
   creating the actual bucket + credentials. Not a blocker for building
   this session, though — the upload path can be written against env vars
   and a documented interface, and tested locally against a
   S3-compatible target (e.g. MinIO in docker-compose) without waiting on
   a real bucket.

5. **OCR on photo uploads.** Tesseract.js (or a cloud OCR API) run
   against an uploaded photo to suggest merchant/total/items into
   `ReceiptForm` — suggestions the user confirms, never silently
   auto-filled and submitted, matching the schema's own
   `VerificationLevel` ladder (OCR output is `UNVERIFIED`/`IMPORTED`, not
   `MERCHANT_VERIFIED`, and should never claim to be). Tests: parser unit
   tests against fixture receipt images/text.

6. **Email ingestion, path A: forward-to address.** The simplest path
   first, per ROADMAP.md's own note that most digital receipts already
   arrive this way today. A per-user forward-to address, a webhook that
   receives inbound mail and parses it into a `Receipt` at
   `VerificationLevel.IMPORTED`. **Needs Omar**: owning a domain + picking
   an inbound-email provider (SendGrid Inbound Parse, Postmark, Mailgun,
   Cloudflare Email Routing). Build the webhook handler against a
   documented payload contract so the provider choice is swappable rather
   than load-bearing in the code. OAuth mailbox scanning (Gmail/Outlook) is
   real Phase 1 scope per ROADMAP.md but explicitly **not** this session —
   it's a materially bigger OAuth/consent surface, sequenced as its own
   Session 9 below rather than folded in here. (An earlier version of this
   file called Phase 1 "complete" after Session 8 while also calling OAuth
   real Phase 1 scope — those can't both be true; Session 9 resolves it.)

7. **Per-retailer parser adapters.** 2-3 real adapters (pick retailers
   Omar actually has receipts from) built on `parseInlinePayload`'s
   existing seed and Session 6's email parser. Tests per adapter against
   real (anonymized) sample receipt text/HTML fixtures.

8. **Hosting: Vercel + hosted Postgres.** Not first despite ROADMAP.md
   listing it first — see the hard gate below for why: no real account
   exists to protect until Session 2, and no real data should reach a
   public deployment before secrets management and backups exist for that
   environment. Before deploying, gate `/api/merchant/receipts` for
   production specifically — today's fix (see "Completed components"
   above) stops it from mutating existing merchant data, but it's still an
   open, unauthenticated, unrate-limited endpoint that creates DB rows and
   claim tokens on every call; anyone reaching a public deployment could
   spend storage/DB resources against it indefinitely. Add an explicit
   env-gated check (e.g. `MERCHANT_API_ENABLED`, defaulting off outside
   local dev) rather than relying on a doc comment to keep it demo-only
   once the internet can actually reach it. **Needs Omar**: creating the
   Vercel project and a hosted-Postgres account (Neon, Supabase, or Vercel
   Postgres) and providing the resulting secrets. Can prep everything
   code-side first (`vercel.json`, env var wiring, the merchant-endpoint
   gate, deploy docs) so the session is short once those accounts exist.

9. **Email ingestion, path B: Gmail/Outlook OAuth scan.** The second half
   of Phase 1's stated email-ingestion scope (ROADMAP.md), deliberately
   sequenced after Session 6's simpler forward-to-address path lands and
   after Session 8's hosting exists (OAuth redirect URIs need a real,
   stable origin — awkward to develop against a hosting target that
   doesn't exist yet). A materially bigger consent surface than Session 6:
   real OAuth scopes, token storage/refresh, and a user-facing
   connect/disconnect flow, not just a webhook. Tests: token refresh
   handling, a disconnected account stops being scanned, parsing failures
   on a real inbox don't take down ingestion for every other user.

Phase 1 is functionally complete once Session 9 ships. Re-baseline after
that — Phase 2 (real search, warranty/return UI, export) becomes the next
cadence.

## Known open decisions

- **Session mechanism**: cookie vs. bearer token (Session 2's call to make
  explicitly — see above).
- **Client-side E2E encryption**: IDent's vault modules are zero-knowledge
  server-side by design (SECURITY.md); receiptless currently is not.
  Receipt data is real financial/purchase history, so this is worth
  revisiting once accounts exist (Session 2+) — not blocking Phase 1, but
  don't let it go undecided past it either.
- **Storage/email/hosting providers** (Sessions 4, 6, 8) — Omar's choice,
  not something to guess at or default silently.

## Hard gate: no real user data before ops infra exists

Same discipline IDent's `IDent_STATE.md` applies to itself: staging/prod
hosting, secrets management, and backups not blocking Phase 1 *coding* is
not the same as them not blocking real users. **No real account gets
created, and no real receipt data gets stored, in any environment beyond
local dev, until Session 8's hosting target has secrets management and
backup/restore-testing in place for it.** Local dev with synthetic data is
unaffected by this gate. `/api/merchant/receipts` stays unauthenticated,
local/demo-only, and now also non-mutating against existing merchant data
(today's fix, see "Completed components" above) until Session 2+3 give it
something real to authenticate against, and Session 8 adds a production
env-gate on top of that before any public deployment.

## Next task

**Session 1 — Postgres migration + testing/CI baseline.** See "Session
cadence" above for full scope. Nothing blocks starting this immediately.
