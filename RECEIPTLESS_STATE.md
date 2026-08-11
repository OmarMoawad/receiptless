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

Last updated: 2026-08-11 — **Session 3 follow-up done** (same-day
hardening after an external review of Session 3's own commit: claim
attach no longer happens on `GET`, plus an expiry/already-claimed status
fix — see "Completed components (Session 3 follow-up)" below). Session 3
itself (scope the vault to a user: `ownerId`, owner-scoped routes, atomic
claim+attach, tenant-isolation test suite), Session 2 (user accounts),
and Session 1 (Postgres migration + testing/CI baseline) were all done
earlier the same day. This file was created earlier still, then
revised after an external review of its initial version (overclaimed
Phase 0 as "verified" with zero automated tests behind that word, had a
real contradiction about which session finishes Phase 1's email-ingestion
scope, and two concrete Phase-0 bugs got fixed alongside the doc
revision). Retroactively logs Phase 0 (ROADMAP.md) as done, and breaks
Phase 1 into a **session-by-session cadence** (below) instead of one big
phase-sized task, so receiptless can be worked in daily increments the
same way IDent's Phase 0B has been — pick up this file, do the next
session, update it, commit, push.

## Current phase

**Phase 1 — Reliable ingestion + accounts** (ROADMAP.md), in progress.
Sessions 1 (Postgres + testing/CI baseline), 2 (user accounts), and 3
(vault scoped to a user) are done — see "Completed components" below.
Phase 0 (canonical foundation) was done before this file existed.

Phase 1 is one paragraph in ROADMAP.md but six real, multi-day pieces of
work (hosting, accounts, storage, OCR, email ingestion, parser adapters).
"Session cadence" below sequences them into 9 sessions (email ingestion
splits into two — forward-to-address, then the materially bigger OAuth
scan — and a testing/CI baseline is folded into Session 1 rather than left
implicit), each a coherent, testable, roughly one-day slice — mirroring
how IDent's sessions work, not ROADMAP.md's phase-sized granularity.

## Completed components (Phase 0 — manually exercised, not test-verified)

Unlike IDent's own "Completed components," this list is **not** backed by
an automated test suite — at the end of Phase 0, receiptless had only
`dev`/`build`/`start`/`lint` scripts, no `test` or `typecheck` script, and
no CI workflow. What's below was built and manually/curl-checked, the way
IDent's own Phase 0A infra was before it grew a real test suite — it was
real, working code, just not held to IDent's later, stronger bar of
"verified." **Session 1 below subsequently closed that gap** — see the
"Completed components (Session 1 ...)" section further down for the real
test suite and CI workflow that now exist; this section is a Phase-0-era
historical record, not a description of the repo's current state.

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

## Completed components (Session 1 — Postgres migration + testing/CI baseline)

This is the first entry in this file backed by a real, running test suite
— see the heading above for why Phase 0's own list isn't. From here on,
new work should look like this entry, not like Phase 0's.

- **Postgres, not SQLite.** `prisma/schema.prisma`'s datasource is now
  `postgresql`; `src/lib/db.ts` uses `@prisma/adapter-pg` (`pg` +
  `@prisma/adapter-pg` added, `@prisma/adapter-better-sqlite3` removed).
  `docker-compose.yml` added, mirroring IDent's exact pattern — one
  difference: port **5433**, not Postgres's default 5432, since IDent's
  own `docker-compose.yml` already binds 5432 on the same dev machine and
  the two projects run side by side. The old SQLite migration history
  (`prisma/migrations/`, two migrations) was deleted and replaced with one
  fresh Postgres migration (`20260811091800_init_postgres`) — no schema
  *shape* change, per Session 1's own scope; local dev data was disposable
  (gitignored `*.db`) so nothing needed preserving. `db.ts`'s connection
  fallback matches `docker-compose.yml`'s fixed local-dev credentials
  exactly, same convention as IDent's `db/pool.ts` — this is what lets
  `npm run test` work without vitest needing its own `.env` loading.
  Manually verified against a live container (not just migration success):
  `POST /api/merchant/receipts` and `GET /api/search` round-tripped real
  data through Postgres, and the merchant-website fix above was
  re-confirmed against real Postgres, not just the earlier SQLite-era fix.
- **Test suite + CI, from zero.** Vitest added (`vitest.config.mts`, `@`
  path alias matching `tsconfig.json`), plus `npm run typecheck`,
  `db:generate` (`prisma generate`), and `db:migrate` (`prisma migrate
  deploy`) scripts. `.github/workflows/ci.yml` added, mirroring IDent's
  own workflow shape (Postgres service container). The step order isn't
  IDent's own (`install → typecheck → db:migrate → test → build`) — a
  first push with that order actually failed CI on a clean checkout
  (`tsc --noEmit` needs `@/generated/prisma/client`, which only
  `db:generate` produces, and needs Next's own `.next/types`, e.g.
  `layout.tsx`'s `LayoutProps`, which only `next build` produces — both
  only "worked" locally because stale generated artifacts were already
  sitting around from earlier manual runs). Fixed and verified clean by
  deleting both generated directories locally and rerunning: `install →
  db:generate → db:migrate → test → build → typecheck`. 16 tests:
  `src/lib/money.test.ts`
  (minor-unit conversion, including the `0.1 + 0.2` floating-point case
  the whole integer-minor-units design exists to avoid), `POST
  /api/merchant/receipts` (issuance, invalid-JSON and missing-field 400s,
  non-integer `totalMinor` rejected, and both merchant-website-fix cases —
  the overwrite-blocked regression test and the sets-on-create case), and
  `GET /api/claim/[token]` (resolve, single-use 409 on a second resolution,
  404 on an unknown token, 410 on an expired one, and a concurrent-claim
  test proving only one of two simultaneous requests for the same token
  wins — the atomic-`updateMany` guarantee `src/lib/claim.ts`'s own
  comment describes, now actually exercised). Route-level tests import the
  exported `GET`/`POST` handlers directly and call them with a constructed
  `NextRequest`, in-process against the real dev Postgres — no mocked DB,
  same philosophy as IDent's `app.inject()`-based tests, adapted to
  Next.js App Router's handler-function shape instead of Fastify's app
  object. `npm run typecheck`, `npm run test`, and `npm run build` all
  pass.

## Completed components (Session 2 — user accounts)

- **New `User`/`Session` Prisma models** (migration
  `20260811102941_add_users_and_sessions`) — cookie-based sessions, the
  decision this session's own plan flagged as needing to be made
  explicitly first: cookie over IDent's bearer-token pattern because
  receiptless is a same-origin Next.js app (IDent only needed bearer
  tokens because its apps/web and apps/api are cross-origin). No AMK/
  vault-key concept — receiptless isn't client-side E2E encrypted (see
  "Known open decisions" below).
- **`src/lib/password.ts`** — scrypt password hashing, byte-for-byte the
  same implementation as IDent's `identity/password.ts` (scrypt's
  parameters aren't app-specific, no reason for the two copies to
  diverge): `scrypt$N$r$p$salt$hash` encoding, OWASP's current
  interactive-login minimum cost.
- **`src/lib/auth-service.ts`** — `register`/`login`/`logout`/
  `validateSession`, mirroring IDent's `identity/service.ts` shape
  exactly, including the timing-safe dummy-hash fallback so "no such
  user" and "wrong password" cost the same wall-clock time on login.
- **`src/lib/auth-cookie.ts`** / **`src/lib/auth.ts`** — `HttpOnly`,
  `SameSite=Lax`, `Secure` in production only (a `Secure` cookie is
  silently dropped over plain `http://localhost`, which would break local
  dev). `getCurrentUser(request)` is the one place every future
  session-gated route (Session 3's owner-scoped receipt routes included)
  should read the current user from.
- **Four routes**: `POST /api/auth/register` (201, sets cookie),
  `POST /api/auth/login` (200, sets a new cookie), `POST /api/auth/logout`
  (204, revokes the session server-side and clears the cookie),
  `GET /api/auth/me` (200 or 401).
- **18 new tests** (34 total): password hashing round-trip/salting/
  malformed-hash handling, register (success, duplicate-username 409,
  invalid-username/weak-password 400s), login (success, wrong-password
  and unknown-username both 401 — same status, timing-safe), logout
  (revokes so a follow-up `/me` 401s, clears the cookie, succeeds even
  with no cookie present), `/me` (valid/missing/invalid cookie).
  `npm run typecheck`, `npm run test`, and `npm run build` all pass.
  **Also manually verified against the live dev server** (not just
  vitest): `curl` through register → `/me` with the real `Set-Cookie` →
  logout → `/me` again correctly 401s — confirms the cookie contract
  works end to end against real Postgres, not just in-process.

## Completed components (Session 3 — scope the vault to a user)

- **`Receipt.ownerId`** (migration `20260811191029_add_receipt_owner`) —
  nullable, indexed, `onDelete: SetNull`. Null means unclaimed: a
  merchant-pushed receipt (`/api/merchant/receipts`) is created with no
  `ownerId`, unchanged from before this session (the field simply wasn't
  set), and stays invisible to every owner-scoped route until claimed.
- **Every receipt-facing route requires a session and scopes its query by
  `ownerId`**: `GET`/`POST /api/receipts` (`GET` also takes an `id` query
  param now, still owner-scoped — a guessed ID from another user's vault
  resolves to an empty list, not their receipt), `GET /api/search`, `GET
  /api/reports/{monthly,annual}`. All four 401 without a valid session
  cookie (`getCurrentUser`, Session 2).
- **`src/lib/claim.ts`'s `resolveClaim` now takes `userId` and does the
  claim+attach atomically**: an unauthenticated caller (`userId: null`) is
  rejected *before* the token is even read, so an anonymous request can
  never burn a token the real owner hasn't claimed yet. The claiming
  update sets `claimedAt` and `ownerId` together in one conditional
  `updateMany` guarded on `claimedAt: null` (and non-expiry) — the same
  guard Session 1/Phase 0 already used for single-use semantics, now also
  gated on authentication and never reassignable after a successful
  claim, since the guarded update can only ever match a still-unclaimed
  row.
- **`src/lib/origin-check.ts`** (new) — `isSameOrigin` (route handlers,
  reading `NextRequest.nextUrl.origin`) and `isSameOriginFromHeaders`
  (Server Components reading `next/headers()`, which has no `nextUrl` —
  reconstructs the expected origin from `Host` + `X-Forwarded-Proto`).
  Both reject a *present-and-mismatched* `Origin`/`Referer`, and treat a
  missing one as same-origin rather than blocking it — a same-site
  defense-in-depth check, not a CSRF token (see "Known open decisions"
  below, unchanged this session). Wired into both claim-attach paths:
  `GET /api/claim/[token]` (403 before touching token state) and the
  `/claim/[token]` page itself, which turned out to be the actual
  claim-attach path real users hit (`SameSite=Lax` still allows the
  session cookie on a top-level cross-site GET navigation, which is
  exactly how someone could otherwise be tricked into attaching a receipt
  they didn't choose to claim).
- **`/claim/[token]`'s page** (`src/app/claim/[token]/page.tsx`) — the
  route handler above and this page were two independent, out-of-sync
  callers of `resolveClaim` before this session (the page is what
  `QRScanner`'s claim-link handling actually navigates to; the API route
  has no in-app caller today, existing for non-browser clients like the
  `receiptless://` scheme). Updated in lockstep: reads the session via a
  new `getCurrentUserFromCookies` (`src/lib/auth.ts`, the Server Component
  equivalent of `getCurrentUser`), shows a "sign in to claim this receipt"
  state when unauthenticated, and checks `isSameOriginFromHeaders` before
  calling `resolveClaim` at all.
- **15 new tests** (49 total, up from 34): the full 10-item
  tenant-isolation checklist below, plus 401-without-session and
  ownership-recorded-on-create coverage for the newly owner-scoped
  routes. A shared `src/test/auth-helpers.ts` (`registerTestUser`,
  `cookieHeader`) factors out the register-then-extract-cookie pattern
  Session 2's own tests already used ad hoc, now reused across
  `receipts`, `search`, `reports/{monthly,annual}`, and `claim` tests.
  `npm run typecheck`, `npm run test`, and `npm run build` all pass.
  **Also manually verified against the live dev server**: registered two
  real users, pushed a merchant receipt, claimed it as one user via both
  the API route and the page, confirmed the other user's list/search/
  reports never see it, confirmed a second claim attempt (same user and a
  different user) both 409, confirmed an unauthenticated request to
  `/api/receipts` 401s without consuming anything, and confirmed a
  forged `Origin: https://evil.example` header gets rejected with 403 on
  both the API route and the page — all against real Postgres, not just
  vitest's in-process test doubles.

**Tenant-isolation checklist (all 10 items, all covered by tests above):**
1. Alice cannot list Bob's receipts — `receipts/route.test.ts`.
2. Alice cannot fetch Bob's receipt by guessed ID — `receipts/route.test.ts`
   (`?id=` query param).
3. Alice cannot search Bob's receipts — `search/route.test.ts`.
4. Alice's reports never aggregate Bob's data —
   `reports/{monthly,annual}/route.test.ts`.
5. An anonymous request cannot attach ownership via claim —
   `claim/[token]/route.test.ts`.
6. Logged-in Alice can claim an unused receipt — same file.
7. Bob cannot claim it afterward (409) — same file.
8. Two simultaneous claims of the same token yield exactly one winner —
   same file.
9. A merchant-created unclaimed receipt stays invisible until claimed —
   `receipts/route.test.ts`.
10. `ownerId` cannot be reassigned after a successful claim — verified
    directly (`stored?.ownerId` checked against the winner) in
    `claim/[token]/route.test.ts`'s concurrent-claim test.

## Completed components (Session 3 follow-up — claim is no longer a GET)

An external review of Session 3's own commit caught something real: the
Origin/Host check added that session was defense-in-depth, but the actual
gap it was covering for was structural, not just missing headers — claim
attach was still reachable through `GET`, and GET is defined as a *safe*
method (RFC 9110). A crawler, link-preview bot, or browser prefetch
following a claim link could consume a token without any user action at
all, no forged headers required. Fixed by removing the mutation from GET
entirely rather than trying to harden it further:

- **`src/lib/claim.ts`** gained `previewClaim(token)` — a read-only
  lookup with no side effects, returning the same terminal states
  (`not_found`/`expired`/`already_claimed`) plus `previewable` (with the
  receipt, for display). `resolveClaim(token, userId)` — the mutating
  atomic claim+attach from Session 3 — is unchanged in its own logic, but
  is now documented and wired as POST-only.
- **`/api/claim/[token]`**: `GET` now calls `previewClaim` and never
  mutates (still requires a session, same as before — this changes
  *when* claiming happens, not who can see a receipt). `POST` is new and
  does the actual claim+attach, with the Origin/Host check from Session 3
  moved here since this is now the only mutating entry point.
- **`/claim/[token]` page** (`src/app/claim/[token]/page.tsx`) — now
  purely a preview: shows merchant/total/items and, if claimable, renders
  `<ClaimButton>`. **`ClaimButton.tsx`** (new, `"use client"`) submits a
  form bound to a Server Action (**`actions.ts`**'s `claimReceipt`, new)
  via `useActionState`, so the claim result (success with receipt detail,
  or an error state) renders in place without a page navigation — this
  also sidesteps a real correctness gap a GET-based redirect-after-POST
  approach would've had: reloading the same URL after *your own*
  successful claim would otherwise be indistinguishable from seeing
  someone else's already-claimed token, since `previewClaim` doesn't
  track who did the claiming. Next.js validates a Server Action's
  `Origin` against the deployment's own host before invoking it at all;
  `claimReceipt` also calls `isSameOriginFromHeaders` explicitly, the
  same defense-in-depth relationship the POST route has with its own
  Origin check.
- **`resolveClaim`'s status-mapping bug fixed**: when the guarded
  `updateMany` matches zero rows, the previous code always reported
  `already_claimed`, even though the real cause could be the token
  expiring in the narrow window between the initial read and the update
  — a 409 vs. 410 difference that's user-visible. Now re-reads the row in
  that branch to report the real reason. Not covered by a dedicated test
  — deterministically forcing that specific microsecond race isn't
  practical without mocking Prisma's timing, and the fix is small enough
  to review directly; flagging that honestly rather than claiming test
  coverage that doesn't exist.
- **Tests**: `claim/[token]/route.test.ts` split into a `GET` suite (5
  tests, including one that calls GET twice and asserts `claimedAt`/
  `ownerId` are still null — the core regression this follow-up exists to
  prevent) and a `POST` suite (8 tests, the same tenant-isolation
  coverage Session 3 had, moved from GET to POST). `receipts/route.test.ts`'s
  claim-then-check-visibility test updated to POST accordingly. 54 tests
  total (up from 49). `npm run typecheck`, `npm run test`, and
  `npm run build` all pass.
- **Manually verified against the live dev server**: repeated `GET`s on
  an unclaimed token stayed `previewable` with `claimedAt`/`ownerId`
  still null in the database; `POST` claimed it; a follow-up `GET`
  correctly reported `409`; the page correctly rendered "Claim this
  receipt?" before claiming and "Already claimed" after; a forged
  cross-origin `POST` was rejected with `403`.
- **`<ClaimButton>` real-browser click-through — done, with Omar,
  2026-08-11** (same day as this follow-up): Chrome automation still
  can't reach `localhost` in this sandbox, so Omar registered a test
  account via a `fetch` snippet in his own browser's console, opened a
  generated claim link, and clicked through it himself, same
  human-in-the-loop pattern IDent's Gmail OAuth flow needed. Confirmed:
  the page showed the "Claim this receipt?" preview first (merchant,
  amount, items) with nothing claimed yet; clicking "Claim this receipt"
  updated in place — no page reload — to the green-checkmark "Receipt
  claimed" state with the same details; reloading the same URL
  afterward correctly showed "Already claimed" instead of the button
  again. The `useActionState`/Server Action wiring is now confirmed
  working end to end, not just at the `resolveClaim` level.
- **Also updated per review**: `ROADMAP.md`'s "Sponsored receipts"
  section gained a hard constraint (sponsored content must never alter/
  obscure/mix with actual receipt data; eventual data model keeps it in
  a separate `ReceiptSponsorship`-style table, not new `Receipt` columns).

This follow-up didn't consume a new session number — it's a same-day fix
to Session 3's own commit, the same convention IDent used for its
"session 14.5" PKCE hardening. The progress bar is unaffected (still
15%, still 3/9 sessions on Phase 1) since no new roadmap ground was
covered, just a correctness fix to already-claimed scope.

## Session cadence for Phase 1 — work one per day, in order

Each session is scoped to be buildable, testable, and shippable in roughly
a day, the way IDent's sessions are — not "start Phase 1," but "do Session
N." Ordered so each one only depends on sessions before it, never after.
Sessions marked **needs Omar** have a real-world decision or account
creation blocking part of them — flagged explicitly rather than guessed at,
same convention IDent uses for its own hosting-target and click-through
gaps.

1. ~~**Postgres migration + testing/CI baseline**~~ — done (see
   "Completed components" above): Postgres + `docker-compose.yml` (port
   5433), Vitest + typecheck + CI workflow, 16 tests covering claim-token
   issuance/resolution/expiry/double-claim, malformed merchant payloads,
   and the money-math helpers.

2. ~~**User accounts: schema + register/login**~~ — done (see "Completed
   components (Session 2)" above): `User`/`Session` models, cookie-based
   sessions (the recommended option, confirmed), `POST /api/auth/
   {register,login,logout}` + `GET /api/auth/me`, 18 tests. No UI yet —
   these are API-only for now, same as session 1's infra work; register/
   login forms are UI work for whichever later session needs them.

3. ~~**Scope the vault to a user**~~ — done (see "Completed components
   (Session 3)" above): `ownerId` on `Receipt`, every receipt-facing route
   owner-scoped, atomic claim+attach, Origin/Host check on both claim
   paths, full 10-item tenant-isolation checklist covered by tests.

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

- ~~**Session mechanism**~~ — decided and built in Session 2: cookie-based
  (`src/lib/auth-cookie.ts`, `HttpOnly`/`SameSite=Lax`/`Secure`-in-prod).
- **Client-side E2E encryption**: IDent's vault modules are zero-knowledge
  server-side by design (SECURITY.md); receiptless currently is not.
  Receipt data is real financial/purchase history, so this is worth
  revisiting once accounts exist (Session 2+) — not blocking Phase 1, but
  don't let it go undecided past it either.
- **Storage/email/hosting providers** (Sessions 4, 6, 8) — Omar's choice,
  not something to guess at or default silently.
- **Session cleanup/limits, not needed yet**: every login currently issues
  a new `Session` row with no cap on concurrent sessions per user and no
  cleanup of expired/revoked ones — fine functionally, but the table will
  grow unbounded over real usage. No UI decision needed now (unlimited
  devices vs. a cap vs. an "active sessions" account page with
  log-out-other-devices are all still open), but a periodic delete of
  expired/revoked rows is worth adding once this sees real traffic —
  flagged by the same external review that shaped Session 3's isolation
  checklist above, not urgent enough to block any current session.

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

**Session 4 — Real object storage for photos (S3/R2).** See "Session
cadence" above for full scope: replace the inline `data:image/*` URL
storage with real uploads to S3/R2, storing only the object key/URL on
`Receipt`. **Needs Omar**: creating the actual bucket + credentials — not
a blocker for starting, since the upload path can be written against env
vars and tested locally against an S3-compatible target (e.g. MinIO in
docker-compose) without waiting on a real bucket.
