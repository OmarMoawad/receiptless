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

> **Phase 3 (Merchant API / SDK) Session 1 — merchant tenancy — is done,
> 2026-08-23 (badge now 1/8, 35%).** Merchants gain an administrative tenancy
> that leaves consumer-vault isolation untouched:
>
> - **Schema (additive migration `20260823220000_add_merchant_tenancy`):**
>   `MerchantAccount` (one per newly created canonical `Merchant`, `merchantId`
>   unique), `MerchantMembership` (`@@unique([accountId, userId])` — one role
>   per member), `MerchantLocation` (`@@unique([accountId, externalId])`), and
>   an append-only `MerchantAuditEvent` protected by a database trigger that
>   rejects UPDATE/DELETE. Enum `MerchantRole = OWNER|ADMIN|DEVELOPER|VIEWER`.
>   Additive-only; `check:migrations` passes. **This touches
>   `prisma/migrations/`, so it is not fully done until `migrate deploy` has
>   run against prod and `/api/health` reads `schema: ok` — a manual release
>   step that needs Omar (production `DATABASE_URL`).**
> - **Service (`src/lib/merchant/`):** `createMerchantAccount` (transactional
>   Merchant+Account+OWNER membership+audit; never claims a pre-existing
>   Merchant by name; taken name → user-safe 409), `listMerchantAccounts`,
>   `add/change/removeMerchantMember` (last-owner protection),
>   `create/update/listMerchantLocation(s)`. One authorization gate
>   (`requireMerchantCapability`) drives a data-defined role→capability matrix;
>   a non-member is 404, an under-privileged member is 403.
> - **Routes + UI:** authenticated `/api/merchant/accounts`,
>   `/accounts/[accountId]/members`, `/accounts/[accountId]/locations` (rate
>   limited via new `merchant-admin` policy; bodies never carry the acting
>   user), and a `/merchant` dashboard whose mutation controls are role-gated
>   as a convenience while the server stays the authority.
> - **Tests:** 29 new tests (schema, service lifecycle/isolation/last-owner,
>   append-only trigger, route 401/403/404/409, role→controls view-model).
>   Full suite 509 passing; typecheck/lint/build/`check:migrations` all clean.
> - **Not verified this session (needs Omar):** the `/merchant` dashboard has
>   no automated DOM test — this repo still has no jsdom/testing-library
>   harness, matching its existing convention, so the interactive create-
>   account/add-location/role-hiding flow is covered by the pure view-model
>   test plus a pending **browser click-through** (create an account, add a
>   location, confirm a second user 404s it, confirm a VIEWER cannot mutate).
>
> **Next action: apply the merchant-tenancy migration to prod (needs Omar),
> run the Session 1 browser click-through, THEN Phase 3 Session 2 — merchant
> API keys** (plan committed at
> `docs/superpowers/plans/2026-08-21-phase-3-session-2-api-keys.md`). The
> older Phase 2 session-8 Settings reconciliation click-through also remains
> an open acceptance gate. See the Desktop execution plan
> (`README-IDent-Receiptless-Execution-Plan.md`) and its `EXECUTION-LEDGER.md`
> for Phase 3's full session sequence.
>
> **Session 8 (FX reconciliation) is done, 2026-08-22, and closes Phase 2
> (Vault maturity).** It fixed the four defects the session-7 review
> found and shipped the owner-driven reconciliation flow:
>
> - **Cold-cache holiday lookup.** The rate-provider contract widened from
>   a single date to an inclusive `[from, on]` window, so a Sunday or
>   holiday purchase discovers Friday's rate in one range request instead
>   of an eight-request retry loop. The CBE adapter picks the newest valid
>   in-window row regardless of actor row order, and the resolver
>   re-rejects any out-of-window date before it reaches `fx_rates`.
> - **Apify token moved out of the URL** into an `Authorization: Bearer`
>   header, so it can never leak through a logged or historied URL.
> - **Conversion races** in initial capture and reprocessing now recover
>   from the partial-unique `P2002` by rereading the approved winner, so
>   concurrent callers converge on exactly one approved snapshot.
> - **Stale-target tax reporting** fixed: a tax summary uses an approved
>   conversion only when its target is the *current* reporting currency; a
>   snapshot into a currency the owner has since left is named as
>   unconverted, never summed under the wrong label.
> - **Owner reconciliation flow:** `previewFxReconciliation` (read-only,
>   no provider call) and `applyFxReconciliation` (deterministic
>   `(purchasedAt, id)` batches of ten, keyset cursor, per-run audit
>   context, stale-currency rejection), behind two session-scoped POST
>   endpoints and a Settings control. **No schema migration** — it reuses
>   the existing conversion provenance fields, so there is no prod
>   `migrate deploy` step for this session.
>
> **The CBE adapter is implemented and wired** (session 7 step 4); it is
> off unless `FX_PROVIDER=apify-cbe` and `APIFY_TOKEN` are set, and manual
> rate entry makes the whole feature work end to end with no provider at
> all. Session 1's Vercel Pro / log drain remains **deferred, not done**.
>
> **Not verified in this session:** the Settings reconciliation UI has no
> automated test — this repo has no jsdom/testing-library harness and its
> client components (e.g. the reporting-currency form) are verified by
> browser click-through, which is still pending here.
>
> **Session 7 (multi-currency with historical FX): steps 1–3 are done,
> 2026-08-21.** The requirement — store the rate used at purchase time,
> never convert on read with today's rate — is met and shipped. The
> feature works end to end today with no third party at all, through
> manual rate entry. **Step 4, the API adapter, is the only part
> outstanding and it needs Omar** (see "What still needs Omar" below).
> Counting the session as done rather than deferred is deliberate: the
> engineering deliverable is complete and in use, and the vendor choice
> is an input to one adapter behind an interface, not a prerequisite the
> rest was waiting on.
>
> What landed:
>
> - **`fx_rates`, append-only.** A correction supersedes rather than
>   updates, so what this app believed a rate was in March survives the
>   belief changing. Three partial unique indexes (raw SQL — Prisma cannot
>   express them) make the resolver deterministic rather than dependent on
>   row order.
> - **An immutable snapshot on the receipt**, carrying every field needed
>   to reproduce the arithmetic: both currencies, both minor-unit scales,
>   the currency-metadata version those scales came from, the rate, the
>   resolver and conversion policy versions, and the unrounded result
>   alongside the rounded one. `fxRateId` is provenance, not a dependency
>   — nothing reads through it to convert.
> - **Currency metadata, because two decimals is not universal.**
>   Everything before this session multiplied by 100. JPY has no minor
>   unit and KWD has three, so converting ¥1000 as though it were ¥10.00
>   is a factor of a hundred. An unknown currency now **fails closed**
>   rather than defaulting to 2.
> - **Rates are canonical decimal text, never IEEE-754.** Canonical form
>   is strict on purpose: `1.5`, `1.50` and `1.500` must not all be
>   storable, or two snapshots that look different mean the same thing and
>   the audit trail stops being decidable. Non-canonical input is
>   rejected, never coerced.
> - **One rounding step, taken last.** Half-up rather than banker's,
>   because this is money reconciled by hand against a card statement —
>   recorded in the policy version so a later change is a new version
>   rather than a silent re-rounding of history.
> - **Reprocessing is explicit and versioned**, with lineage back to the
>   figure it replaces. No background refresh may move a stored
>   conversion; nothing calls it from a cron or a sync path.
> - **The tax summary converts** at each receipt's stored rate instead of
>   refusing, and still names what it cannot convert rather than folding
>   it into a total — on the page and in the CSV, because the file
>   outlives the page it came from.
>
> Two findings worth carrying forward:
>
> 1. **`prisma migrate dev` wants to drop the full-text GIN index every
>    time.** `searchVector` is an `Unsupported("tsvector")` column, so the
>    index created in session 3's raw migration is invisible to the schema
>    and reads as drift. Applying that DROP would turn every search into a
>    sequential scan — no error, no failing test, just a query plan that
>    degrades with the size of a vault. It was removed from this
>    migration by hand and the reason is written at the top of the file.
>    **Check for it in every future generated migration.**
> 2. **`AmbiguousRateError` is unreachable while the partial indexes
>    exist**, which is the stronger result and why there is deliberately
>    no test for it. It stays as defence in depth against a later
>    migration dropping an index — precisely the failure that would turn
>    "the active rate" back into "whichever row came back first".
>
> Superseded, kept because the ordering argument is what unblocked the
> session: **build it in this order. Steps 1–3 need nothing from anyone;
> only step 4 is blocked on a decision.** The point of the ordering is
> that the vendor question stops being a prerequisite: session 7 is a
> storage and discipline problem, and the provider is one adapter behind
> an interface.
>
> 1. **An `fx_rates` table** — `(base, quote, date, rate, source,
>    fetched_at)`. The rate is captured at ingest and **stored on the
>    receipt**, so a rate revision, a corrected series, or a provider
>    disappearing entirely can never retroactively change what a past
>    purchase cost. This is the whole requirement; everything else serves
>    it.
> 2. **A provider interface, with a manual-entry implementation first.**
>    That alone makes the feature work end to end with zero third-party
>    dependency, and it is what a person needs anyway for a currency no
>    provider covers.
> 3. **A visible "rate unavailable" state.** Same honesty the tax summary
>    already applies to mixed currencies — say the number is not known
>    rather than substitute today's rate for it.
> 4. **An API adapter**, once a provider is chosen. **Needs Omar.**
>
> **Snapshot contract for steps 1–3 (a required design, not a claim that
> it exists today).** Define a rate as quote-currency units for one unit of
> base currency, and accept it as a canonical base-10 decimal representation
> — never an IEEE-754/JavaScript number. The supported rate precision,
> calculation scale, and final-money rounding mode are a versioned
> implementation decision to make before the migration, not constants this
> roadmap pretends are settled. The selected policy/version, canonical rate,
> and unrounded and rounded results belong in every snapshot. Input outside
> that version's supported precision or canonical form must be rejected, not
> silently truncated or coerced, so a future policy can still reproduce an
> older conversion.
>
> A snapshot also names the receipt's source currency and the target/reporting
> currency, plus the source and target minor-unit scales used for that
> conversion. It identifies the versioned currency-metadata source which
> supplied those scales (for example, the precise ISO-4217 dataset revision
> or an explicitly versioned successor), rather than assuming every currency
> has two decimal places. Receiptless currently uses a two-decimal
> integer-minor-unit convention; supporting zero- and three-decimal
> currencies is therefore a prerequisite design, migration, and test gap for
> Session 7, not functionality this document claims already exists. The
> applied rate, direction, effective date, currency-metadata version, and
> rounded result must be reproducible without a provider call.
>
> A manual rate is tenant-owned, not a global mutable override: every manual
> rate lookup and correction is scoped to its owner. For a given
> owner/base/quote/effective-date key there can be one active manual rate; a
> correction is an append-only replacement that identifies the rate it
> supersedes, the person making it, when it was made, and why. Provider-rate
> selection also needs a configured, versioned source policy and at most one
> active provider rate for each source/base/quote/effective-date key. The
> resolver records that policy/version and has deterministic precedence — an
> owner's manual rate first, then the configured provider source — and rejects
> an ambiguous key rather than choosing whichever row was fetched last.
> Provider and manual entries alike need provenance sufficient to audit the
> choice: source/provider identity, effective date, fetched or entered time,
> and for manual entry the actor and stated reason (plus the provider response
> or reference when one exists).
>
> The receipt must copy an immutable snapshot of the selected rate, currency
> metadata, policy version, and provenance, not depend only on a live
> `fx_rates` lookup. Later provider or manual corrections must not rewrite
> that snapshot. If a correction really should change a receipt's derived
> converted amount, use an explicit, authorised reprocessing operation that
> creates an append-only conversion version with lineage to the original:
> record the receipt, old and new snapshots, parent version, operator, reason,
> timestamp, and run/correlation identifier. Reports must use an explicit
> current-approved conversion-version selector; approval can move to a
> deliberate corrected version, while the original conversion and every prior
> version remain retained and traceable. No background refresh may do this
> implicitly.
>
> **What still needs Omar — step 4, the API adapter.** The seam is built
> and empty: `src/lib/fx/provider.ts` defines `FxRateProvider` and
> `configuredProvider()` returns `null`. Adding one is an implementation
> of that interface and nothing above it changes — a fetched rate is
> stored in `FxRate` exactly like a manual one, and the snapshot on the
> receipt is identical in shape. Nothing is blocked in the meantime;
> manual entry is a permanent path, not a stopgap.
>
> **The provider shortlist was checked against current terms on
> 2026-08-21 — see `docs/fx-provider-comparison.md`.** Three things came
> out of it that change the shape of the decision:
>
> 1. **The real question is mid-market rate vs Central Bank of Egypt
>    rate, not which aggregator.** They are different numbers, and EGP is
>    where they diverge most. An Egyptian accountant filing a return
>    expects the CBE rate; a mid-market aggregate answers a different
>    question. Settling this eliminates most of the shortlist on its own.
> 2. **CBE has no public API and blocks scrapers.** A request to its
>    rates page returns "The requested URL was rejected" — there is a WAF
>    in front of it, so a serverless function would be blocked the same
>    way. The only reachable route to official CBE rates is a
>    community-maintained Apify actor at roughly **$0.50–$2.50 per year**
>    of rates. The obvious objection to depending on it is the risk this
>    session already designed for: rates are snapshotted onto receipts,
>    so the actor disappearing cannot change any figure already recorded.
> 3. **The blocker is the card, not the price.** Every viable option
>    needs one, *including the free tiers* — exchangerate.host requires a
>    card to issue a free key, and its free plan has **no HTTPS**, which
>    disqualifies it outright. CurrencyAPI's free tier is explicitly
>    "Private Use". This is the same wall Vercel Pro hit, and the two
>    deferrals should be resolved together rather than separately, since
>    both turn on whether Receiptless takes payment.
>
> Volume is not a factor and should not drive the choice: the snapshot
> design calls a provider **once per currency pair per date**, so real
> usage is tens of requests a month. Every paid tier is sized for a
> volume this app will not approach for years.
>
> **What actually decides the provider is EGP, and it eliminates the
> obvious answer.** The natural free choice is Frankfurter — ECB-backed,
> no API key, no signup and no card, which matters because Vercel already
> rejected the prepaid and virtual cards reachable from Egypt. But the
> ECB's reference rates **do not include EGP**, and that is the currency
> this app most needs. It would only have surfaced after building against
> it.
>
> So the shortlist is providers with EGP *history*, where free tiers
> typically either forbid commercial use or withhold historical data —
> the same licensing trap logged below for the Surya OCR weights. Do not
> pick one from memory: terms and pricing change, so check two or three
> candidates' **current** terms for EGP historical coverage and commercial
> use, and put the comparison in front of Omar. By then the app already
> works through manual entry, so the decision is unhurried and reversible.
>
> **Session 6 (tax-category tagging) is done, 2026-08-21.** A rules layer
> classifies receipts and line items on the way in, on every ingestion
> path including the ones with no UI; `/tax` totals a year by category and
> exports it. Current verification is **384 tests across 49 files**;
> typecheck is clean and the optimized build passes with all four new routes
> present. Full detail under "Completed components (Phase 2 session 6)"
> below.
>
> **Session 5 (CSV and PDF export) is done, 2026-08-20.** Both exports are
> authenticated, owner-scoped, batched, and streamed. CSV is an analysis-
> friendly item-granularity archive; PDF is a readable receipt archive.
> The vault links to both. Full detail under "Completed components (Phase
> 2 session 5)" below.
>
> **Session 4 (warranty and return windows) is done, 2026-08-20.** The
> `warrantyMonths` and `returnWindowDays` columns have been on
> `ReceiptItem` since Phase 0 as a "lightweight seed"; nothing had ever
> read them. `/coverage` now answers "still under warranty" and
> "returnable until" as two separate lists, `/receipts/[id]` is the first
> per-receipt page this app has had, and coverage can be entered against
> any receipt. Full detail under "Completed components (Phase 2 session
> 4)" below, including two limitations that are recorded rather than
> fixed.
>
> **Session 3 (real search) is done, 2026-08-19.** Postgres full text with
> a trigger-maintained `tsvector`, weighted merchant > items > notes, GIN
> indexed, ranked, with the UI showing *why* each receipt matched. It also
> fixed a live bug: the previous search used Prisma's `contains` without
> `mode: "insensitive"`, which compiles to `LIKE` and is **case-sensitive
> in Postgres** — so searching `flat white` never found `Flat white`.
> Semantic search remains explicitly out of scope.
>
> **Session 1 (Vercel Pro + log drain) is deliberately deferred, not
> forgotten.** Investigating it produced three findings that shrank it:
> previews are already protected by Vercel Authentication on Hobby (not a
> Pro feature); Hobby function duration is already 300s, the same default
> as Pro; and the drain's day-to-day value is now largely covered for
> free — an uptime monitor, a cron heartbeat and app-level logging, all
> live as of 2026-08-19 (DEPLOYMENT.md §3d). What Pro still buys is the
> platform log stream for post-mortem of a killed invocation. Payment is
> also a real obstacle: Vercel takes bank-issued cards only, and rejects
> the prepaid and virtual cards reachable from Egypt.
>
> **What un-defers it**, recorded because a deferral that only says "not
> now" gets re-litigated every time someone reads it, and because the
> trigger below is not the one this entry was originally about:
>
> 1. **Receiptless taking money — this is the real one.** Vercel's Hobby
>    tier is for personal, non-commercial use; a commercial project is
>    expected to be on a paid plan. The day this charges anyone, a paid
>    plan stops being an observability upgrade and becomes a terms
>    requirement, and the log drain arrives as a side effect rather than
>    as the reason. Check the current plan terms at that point rather
>    than trusting this line — it is a summary of someone else's policy,
>    which is the kind of fact that changes without telling you.
> 2. **A killed invocation that actually needs a post-mortem.** The gap
>    is specific: app-level logging dies with the process, so a function
>    killed mid-flight leaves nothing behind. One real incident where
>    that silence is what blocks the diagnosis is enough to justify the
>    plan on its own merits. None has happened yet.
> 3. **A bank-issued card becoming available.** Only removes the
>    obstacle; it is not a reason on its own, and buying the plan because
>    payment finally works would be the wrong order.
>
> Until one of those, staying on Hobby is the correct call and not a
> compromise: items one through three of the paragraph above mean Pro
> currently buys one narrow capability that nothing has yet needed.
>
> Superseded: **Phase 2 session 1 — upgrade Vercel to Pro, then wire
> the log drain. It needs Omar and nothing else in it can start.**
> Session 2b is done (2026-08-16) and closed every review item that an
> agent can close without an account, a purchase, or production
> credentials: independent backups with a rehearsed restore (#1),
> retryable parsing and the review list (#6/#7), plausibility checks and
> the amount-parsing bug they uncovered (#8), OCR labelled unavailable
> (#9/#10 engineering half), a real-browser end-to-end journey (#12), and
> scheduled session cleanup (#14).
>
> **The production data audit is DONE, 2026-08-18** — run by Omar in
> Neon's SQL editor against the production branch, with the results
> below. #6's existing rows are closed. See "Production data audit" for
> the evidence and for the two tooling bugs it exposed.
>
> **What is left of the review is now exactly the set that needs Omar**,
> and it is short: the Vercel Pro purchase and the log drain (#3), a Neon
> retention decision and a production restore (#1's remaining half), the
> Surya weights licensing question (#9/#10), OAuth publication (#13), and
> the session-cap product decision (#14). After that, Phase 2 sessions
> 3–7 are ordinary feature work.
>
> Superseded: **Phase 2 session 2b — the rest of the external review
> list.** Session 2a is done (2026-08-16): **rate limiting and a
> consistent trusted-origin policy**, review findings #4 and #5, the two
> the sequencing note below calls the ones that gate real users.
>
> Still true, and still first in the cadence: **session 1 — upgrade
> Vercel to Pro, then wire the log drain — needs Omar** and nothing else
> in it can start. Session 2a was done ahead of it because it needed no
> purchase; that ordering is a fact about who can do what, not a demotion
> of the drain.
>
> Superseded: **Phase 2 session 1 — upgrade Vercel to Pro, then wire the
> log drain.** Chosen as the milestone's first item on 2026-08-15 because
> it is the only unmet Session 10 exit criterion and it needs a purchase
> rather than engineering time. **Needs Omar**; nothing else in that
> session can start first. Neon's retention window is now confirmed at
> 6 hours — see "Backup posture".
>
> Superseded: **confirm Neon's retention window, then Phase 2 session 1.**
> **Session 10 is COMPLETE** — a real Gmail account connected to
> production and 25 real receipts imported, 0 failed. Two carry-over
> items: the log drain, and the Neon retention window, which now matters
> more because real receipt data exists. Parse quality against real mail
> is poor and deserves its own session — see "Session 10 — COMPLETE".
>
> Superseded: **finish Session 10's slice — connect a real Gmail account.**
> receiptless is **deployed and verified**: https://receiptless-theta.vercel.app,
> 12/12 automated checks, rollback rehearsed at 42 s recovery. What remains
> is the log drain, the Neon retention window, and the one thing all of it
> was scaffolding for — a real receipt arriving from a real mailbox. See
> "Session 10 Part B — deployed and verified" below.
>
> Superseded: **Session 10 Part B — create the accounts, then deploy.**
> Part A is done (2026-08-14). Part B's *code* half is done (2026-08-15):
> error tracking, a rollback procedure, and a verification script all
> exist and are exercised locally. What remains is the half that needs
> accounts — Neon, Cloudflare R2, Vercel, Google Cloud, Sentry — and only
> Omar can create those. The runbook is `DEPLOYMENT.md`; hand back the
> production URL and `node scripts/verify-deployment.mjs <url>` checks the
> exit criteria. See "Session 10 Part B progress" below.
>
> Objective 0 is done: PRs #1–#4 are on `main`, verified with
> `git merge-base --is-ancestor`, not with GitHub's MERGED label. CI run
> [31776002762](https://github.com/OmarMoawad/receiptless/actions/runs/31776002762)
> succeeded on `6e179d22`, checked 2026-08-14 19:05 local. The `agent/*`
> worktrees from that stack are gone.

Last updated: 2026-08-13 — **Sessions 8 and 9 done: Phase 1 is
code-complete.** Session 8 turned `/api/merchant/receipts`'s "local/demo
only" doc comment into a real gate (off by default in any deployed
environment, Vercel previews included, failing closed on anything but the
exact string `true`), and prepared `vercel.json`, a value-free
`/api/health` readiness endpoint, and `DEPLOYMENT.md`. Session 9 added
Gmail OAuth receipt scanning — PKCE, `gmail.readonly` only, encrypted
tokens, refresh with a buffer, a disconnect that deletes token material,
and per-message failure isolation — reusing Session 6's ingestion core
rather than duplicating it, so a receipt imports identically whichever
path delivered it.

**Test count corrected, 2026-08-14:** this entry said "188 tests". A real
run at `6e179d2` reports **201 tests across 27 files**, all passing (see
the evidence ledger below). 188 was either miscounted or counted before
the last additions landed; either way it was carried forward unchecked,
which is the exact habit Part A exists to stop.

**What "code-complete" does not mean:** nothing is deployed, and no Google
OAuth client exists. Both gaps need Omar (accounts, credentials), both are
marked in the cadence below, and neither session is claimed as verified
against real infrastructure. Phase 2's cadence is re-baselined at the end
of this file.

Also fixed a long-running annoyance: vitest is capped at 4 workers now.
The suite shares one Postgres, and above that, unrelated tenant-isolation
and auth tests fail on connection contention during full runs while
passing in isolation — misread as a regression more than once, including
by a reviewer.

Previously — **Session 7: format-keyed receipt parser
adapters are implemented and automated-test verified.** Email parsing now
runs through a registry (`src/lib/receipt-adapters/`) that picks a parser
from the email's *structure* — an itemized order summary, a labelled
key/value block, or a printed point-of-sale slip — instead of running every
email through the OCR slip heuristics. ROADMAP.md calls this bullet
"per-retailer parser adapters"; building it format-keyed rather than
brand-keyed was **decided with Omar (2026-08-13)**, because a brand adapter
helps exactly one retailer and breaks the first time that retailer restyles
its mail. A brand-specific adapter can still be prepended to the registry
later for a format none of the three cover. Two real gaps closed on the way:
a receipt now takes its date from the email (printed date, else the `Date`
header) rather than the ingestion clock, and each delivery records which
adapter parsed it (`InboundEmailDelivery.adapterId`). **Fixture caveat, not
a detail:** the roadmap asked for tests against real anonymized receipts;
Omar's actual receipt mail was not available, so every fixture in
`receipt-adapters/fixtures.ts` is **synthetic and clearly marked as such**.
The tests prove the adapters and dispatch behave as specified, *not* that
any real retailer's email looks like this — validating that against genuine
mail is the first task of a future session.

**Code review addressed, 2026-08-13.** Two real defects in this session's
own work, both found by review rather than by the tests or the
click-through — worth recording because both were *wrong-by-construction*
rather than merely untested:

1. **The email's `Date` header was being used as the clock that validates
   dates** (`inbound-email-ingestion.ts` passed it in as `receivedAt`, and
   the registry compared the printed date against that same value). A
   sender could therefore set `Date: 2099-01-01` and have it both become
   the purchase date *and* raise the future-date ceiling enough for a
   printed 2099 date to pass — the check authorized the very input it was
   meant to bound. Now there are two clearly separated timestamps:
   `ingestedAt` (our clock, trusted, the only validation reference) and
   the header (untrusted, just one more candidate that must itself pass
   validation). Resolution order is printed date → header → `ingestedAt`.
2. **Impossible calendar dates were silently rolled forward.** `Date.UTC`
   turns 2026-02-31 into 3 March and 29 Feb in a non-leap year into 1
   March, so a corrupt printed date became a confident wrong date. Every
   component is now read back off the constructed date and must match;
   leap-year and invalid-day cases are covered by tests.

153 tests (was 136). The reviewer's other observations were accepted as
correct and are reflected above.

**Real-browser click-through done, 2026-08-13 — no bugs found**, the first
session here where that's true. Against a live `npm run dev` and real
Postgres: registered a user, `GET /api/email/forwarding-address` returned
an opaque plus-address and returned the *same* one on a second call
(upsert, not regenerate); all three formats were delivered through the
actual Basic-authenticated webhook and each was parsed by the expected
adapter — `order-summary` took the labelled grand total (13.61) over the
subtotal and kept `2 x Flat white` as quantity 2 / 700 extended / 350
unit; `key-value` produced EGP 245.50 with **zero** line items (no phantom
item from the total row); `pos-slip` handled an HTML-only body, took the
total (4.53) over the subtotal, and the `<script>` tag did not survive
into `rawPayload`. A retry returned `duplicate`, an unknown mailbox
returned `ignored`, and wrong credentials returned 403. In the vault UI all
three receipts showed **their own printed dates** (2026-07-04, 2026-08-12,
2026-08-01) rather than the ingestion date — the Session 7 date fix
confirmed live — and searching a line item ("Flat white") returned exactly
the receipt that contained it. **Still not verified:** real Postmark, a
real domain/DNS, and public HTTPS delivery — those need Omar and remain
open.

Session 6 was the prior session:
**provider-neutral forwarded-email
ingestion with a Postmark adapter is implemented and automated-test verified.**
Each user gets a stable opaque plus-address; the Basic-authenticated webhook
normalizes bounded text/HTML, routes only through the server-resolved mailbox
token, creates owner-scoped `EMAIL` / `IMPORTED` receipts, and records provider
message IDs so Postmark retries are idempotent. Inbound content cannot mutate
existing Merchant metadata or claim merchant verification. Real Postmark,
domain/DNS, HTTPS deployment, IP allowlisting, and an end-to-end delivery
click-through still need Omar and are not claimed complete. Session 5 follow-up
was the prior session: real-browser
click-through with Omar found real bugs, then a real architecture
change** (see "Completed components (Session 5 follow-up)" below). The
click-through found three genuine parser bugs (all fixed) and confirmed a
real ceiling: Tesseract.js's own character-recognition accuracy on old/
faded receipts. That prompted swapping the OCR engine entirely — from
client-side Tesseract.js to a self-hosted Surya OCR service (PaddleOCR
was tried first, same day, benchmarked as the strongest fully
open-source option — abandoned after its official binaries crashed on
this dev machine; see "Completed components (Session 5 follow-up)"
below for the full story), which also moved OCR from browser-side to a
new server route. Session 5 itself
(OCR on photo uploads, original version — see "Completed components
(Session 5)" below) is superseded by the follow-up in every way that
matters (the engine changed) except the parser it feeds, which is
unchanged. Session 4 (real object storage for receipt photos — see
"Completed components (Session 4)" below). Session 3
follow-up (same-day hardening: claim attach no longer happens on `GET`,
plus an expiry/already-claimed status fix, plus a real-browser
click-through of the fix with Omar), Session 3 itself (scope the vault to
a user: `ownerId`, owner-scoped routes, atomic claim+attach,
tenant-isolation test suite), Session 2 (user accounts), and Session 1
(Postgres migration + testing/CI baseline) were all done earlier the same
day. This file was created earlier still, then
revised after an external review of its initial version (overclaimed
Phase 0 as "verified" with zero automated tests behind that word, had a
real contradiction about which session finishes Phase 1's email-ingestion
scope, and two concrete Phase-0 bugs got fixed alongside the doc
revision). Retroactively logs Phase 0 (ROADMAP.md) as done, and breaks
Phase 1 into a **session-by-session cadence** (below) instead of one big
phase-sized task, so receiptless can be worked in daily increments the
same way IDent's Phase 0B has been — pick up this file, do the next
session, update it, commit, push.

Session 6 verification on 2026-08-13: **111 tests across 21 files passed**,
`npm run typecheck` passed, `npm run build` passed, and ESLint reported zero
errors (two pre-existing unused-parameter warnings in the claim action).

## Current phase

**Phase 1 — Reliable ingestion + accounts** (ROADMAP.md), in progress.
Sessions 1 (Postgres + testing/CI baseline), 2 (user accounts), 3 (vault
scoped to a user), 4 (real object storage for photos), and 5 (OCR on
photo uploads), and 6 (forwarded-email ingestion) are done — see "Completed components" below. Phase 0
(canonical foundation) was done before this file existed.

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

## Completed components (Session 4 — real object storage for photos)

- **`src/lib/storage.ts`** (new) — an `ObjectStorage` interface
  (`put`/`getSignedUrl`/`delete`) with an S3-compatible implementation
  (`s3Storage`) built on the `minio` npm package rather than the official
  `@aws-sdk/client-s3`: at the time of this session, every recent
  `@aws-sdk/client-s3` release on the npm registry depended on
  `@aws-sdk/types@^3.974.3`, a version that didn't exist on the registry
  (confirmed with a clean install in an isolated temp directory, not
  specific to this repo — a genuine upstream breakage, not a config
  issue). `minio` speaks the same S3 API against any S3-compatible
  endpoint (real AWS S3, R2, or local MinIO), so this isn't a
  MinIO-only workaround — only `S3_ENDPOINT`/credentials change to point
  at a real bucket later. Revisit swapping to the official AWS SDK once
  its registry state is sane again, if there's ever a reason to (no
  functional gap forcing it).
- **Never a public URL.** The bucket itself is never public — `Receipt`
  stores only an `imageKey` (Session 3's schema also gained this
  session), and `getSignedUrl` hands out a **5-minute presigned URL**
  on demand, only after an ownership-scoped lookup
  (`GET /api/receipts/[id]/photo`, below). A leaked or guessed object key
  alone is never enough to read someone else's receipt image — verified
  against real MinIO (see "Manually verified" below), not just asserted.
- **Content-type sniffed from the file's own magic bytes**
  (`sniffImageContentType`), never trusted from a client-supplied
  filename or `Content-Type` header — both are attacker-controlled.
  Accepts JPEG/PNG/WEBP only. **Object keys are unpredictable**
  (`receiptImageKey`: `receipts/${ownerId}/${24-random-bytes}.${ext}`) and
  **owner-namespaced from the authenticated session only** — a client can
  never choose or influence `ownerId` in the key, so there's no way to
  write into (or, combined with the point above, read from) another
  user's namespace.
- **`POST`/`GET /api/receipts/[id]/photo`** (new route) — both look the
  receipt up scoped by `ownerId` first (`prisma.receipt.findFirst({
  where: { id, ownerId } })`), the same tenant-isolation mechanism
  Session 3 established for every other receipt-facing route: this is
  what makes the photo routes isolated too, not anything key-format
  specific. `POST` enforces `MAX_IMAGE_BYTES` (8MB, matching Phase 0's old
  `imageUrlSchema` cap), sniffs content type, uploads, then updates
  `Receipt.imageKey` — wrapped so a DB-write failure after a successful
  upload deletes the just-uploaded object instead of orphaning it, and a
  photo *replacing* an existing one deletes the old object once the new
  one is safely referenced. `GET` 404s if there's no photo yet, otherwise
  307-redirects to a freshly generated signed URL.
- **`Receipt.imageUrl` retired, `imageKey` takes its place** (migration
  `20260811201429_add_receipt_image_key`) — Phase 0's inline
  `data:image/*` URL storage is gone from `createReceiptSchema` entirely;
  a photo is now a separate upload after the receipt exists, not part of
  receipt creation. Safe to drop outright rather than migrate/backfill:
  the hard gate in this file (no real user data anywhere beyond local
  dev) means no real inline-image data existed to lose.
- **Frontend**: `receipts/new/page.tsx` keeps the raw captured `File`
  instead of base64-encoding it into a data URL; `ReceiptForm.tsx` builds
  a local `URL.createObjectURL` preview (no server round trip just to
  show what was captured), creates the receipt first, then uploads the
  photo as a second `multipart/form-data` request once an id exists. If
  the photo upload fails, the receipt itself is still saved (already
  the more important half) and an inline error says so, but there's no
  retry-upload affordance yet — the copy doesn't claim one.
- **Test-only injection seam** (`getObjectStorage`/`setObjectStorage` in
  `storage.ts`, `FakeObjectStorage` in `src/test/fake-object-storage.ts`)
  — mirrors IDent's `FakeGoogleOAuthClient` pattern from its own session
  14 (wrap the external API surface behind a small interface so tests get
  a fake instead of needing the real dependency reachable in CI).
  Deliberate choice: MinIO is **not** wired into GitHub Actions as a
  service container — this repo's Postgres service container already
  sets a precedent that could have extended to MinIO, but doing that
  blind (no way to dry-run a CI config change before pushing) carried
  real risk of quietly breaking a CI setup Omar depends on being green,
  for a dependency this session can test just as rigorously against a
  fake instead. Real MinIO is still exercised, deliberately, by the
  manual verification pass below — this isn't skipping real-backend
  testing, just not routing it through CI.
- **22 new tests** (76 total, up from 54): `storage.test.ts` (magic-byte
  sniffing for all three formats plus rejection cases, key format/
  uniqueness/namespacing) and the photo route's own suite — 401s, 404 on
  an unknown receipt, **404 on another user's receipt for both `POST` and
  `GET`** (this session's analogue of Session 3's tenant-isolation gate:
  "Alice cannot obtain Bob's image even if she knows its id"), successful
  upload with correct `imageKey`/DB/storage state, rejected non-image
  payload (and confirms storage was never called), rejected oversized
  payload, and replace-deletes-the-old-object. `npm run typecheck`,
  `npm run test`, and `npm run build` all pass.
- **Manually verified against real MinIO** (`docker compose up minio`,
  not the fake): registered a user, created a receipt, uploaded a
  hand-built real PNG via `curl -F`, confirmed the stored `imageKey` and
  a `GET` producing a genuine `AWS4-HMAC-SHA256`-signed redirect whose
  target, once fetched, was byte-identical to the uploaded file.
  Confirmed a second user gets `404` on both `GET` and `POST` against the
  first user's receipt. Confirmed replacing the photo left the *old*
  object key genuinely gone from MinIO (`mc stat` against it 404s) while
  the new one exists.
- **`receipts/new` upload UI real-browser click-through — done, with
  Omar, 2026-08-11**: registered via a console `fetch` snippet, uploaded
  a real photo through the actual form, and saved successfully. This
  click-through is exactly what surfaced the Session 4 follow-up bug
  directly below — the receipt saved correctly but didn't appear in
  Omar's own vault list, which led straight to a real, more serious
  finding than anything about the upload path itself.

## Completed components (Session 4 follow-up — vault pages had no owner scoping at all)

Omar's own click-through of the upload flow above surfaced this: his
saved receipt didn't show up on `/receipts`. The actual cause was worse
than a pagination quirk. `src/app/receipts/page.tsx` (the vault list) and
`src/app/page.tsx` (the home dashboard) both query `prisma.receipt`
**directly**, as Server Components — neither one goes through
`/api/receipts` or `/api/reports/*`, so **neither one ever inherited
Session 3's tenant-isolation work at all**. Before this fix, both pages
had zero auth check and zero `ownerId` filter: `/receipts` listed every
user's receipts mixed together (Omar's own receipt was merely pushed
past the hardcoded `take: 100` by ~260 unrelated test receipts from this
session's own testing, which is what he actually observed), and `/`
aggregated every user's spend into one dashboard. This is a real gap in
Session 3's own claimed "hard acceptance criterion, not just getting
`ownerId` into Prisma" — the criterion was met for every route that goes
through the API, but these two pages were never audited because they
don't.

- Both pages now read the session via `getCurrentUserFromCookies`
  (`src/lib/auth.ts`, the same Server Component helper the claim page
  uses) and show a sign-in prompt instead of any data when logged out.
  Both queries now filter by `ownerId`, matching `/api/receipts` and
  `/api/reports/*` exactly.
- **Manually verified against the live dev server**: a logged-out
  request to `/receipts` and `/` both show the sign-in prompt with zero
  receipt data leaked; a fresh test user sees only their own receipt; a
  second test user querying the same page does not see the first user's
  receipt at all. Confirmed directly against the database that both of
  Omar's own uploaded receipts have his real `ownerId` and will now
  appear on his own `/receipts` page.
- **No dedicated automated test added for these two pages** — this repo
  has no existing convention for testing Server Component pages (the
  claim page has none either, per Session 3's own notes); the fix itself
  is a straightforward mechanical match to the already-tested API-route
  pattern, and it was verified live end-to-end above. Worth revisiting if
  this repo ever adds page-level test infrastructure.
- **Lesson for future sessions**: any session that changes tenant-scoping
  semantics (like Session 3's `ownerId` work) needs to grep for *every*
  direct `prisma.*` call across `src/app/**/page.tsx`, not just
  `src/app/api/**/route.ts` — a page that queries the database directly
  bypasses whatever isolation the API layer enforces entirely, and
  nothing about Next.js's App Router makes that obvious from the file
  structure alone.

## Completed components (Session 5 — OCR on photo uploads)

- **`src/lib/receipt-ocr-parser.ts`** (new, pure, unit-tested) —
  `parseReceiptText(rawText: string): OcrReceiptSuggestion` turns raw OCR
  text into `{merchant, totalMinor, currency, items}` suggestions via
  heuristics matched to how real printed receipts are laid out: the
  merchant is the first non-price-looking line; the grand total is found
  scanning bottom-up for a line containing "total" but not "subtotal"/
  "pre-tax" (so it isn't shadowed by the subtotal line printed above it);
  line items are any other line ending in a right-aligned amount, skipping
  tax/payment/total lines; currency is detected from a `$`/`€`/`£` symbol
  anywhere in the text. Amount parsing (`parseMoneyToMinor`) treats the
  *last* `.`/`,` in a matched amount as the decimal separator so both
  `12.99` and `12,99` (US vs. European receipts) parse correctly, always
  returning integer minor units — matching the rest of the schema's
  money-as-integer discipline, never a float.
- **`src/lib/ocr.ts`** (new, browser-only) — `recognizeReceiptText(file)`
  wraps `tesseract.js`'s `createWorker("eng")` + `.recognize()`, run
  entirely client-side against the just-picked `File`, before a receipt
  exists server-side (there's nothing to authenticate or upload yet at
  that point in the flow — see `receipts/new/page.tsx` below). Not unit
  tested, the same convention `QRScanner.tsx`'s `jsQR` usage already
  established for this repo: a real WASM OCR engine isn't something
  vitest should run, and the actual heuristic logic it feeds
  (`receipt-ocr-parser.ts` above) already is.
- **`receipts/new/page.tsx`**: `handlePhoto` now runs OCR against the
  picked file (a new `"photo"` loading-state render, "Reading receipt…")
  before showing the form, then merges only the fields OCR actually found
  (`merchant`/`amount`/`currency` — omitted, not set to `undefined`, when
  absent, so `ReceiptForm`'s own `USD` default isn't accidentally
  clobbered) into `initialValues`. A failed/empty OCR read falls back to a
  blank manual-entry form with an honest inline message instead of
  blocking the capture flow — matches the schema's `VerificationLevel`
  ladder discipline of never fabricating data that wasn't actually read.
- **`ReceiptForm.tsx`** gained `ocrSuggested`/`ocrError` props: when OCR
  found something, an amber banner reads "Merchant/amount were
  auto-detected from your photo — please review before saving" —
  suggestions the user can freely edit, never silently auto-filled *and*
  submitted. The receipt is still created through the existing `POST
  /api/receipts` path unchanged, which has no field for a client to claim
  a higher verification level — every OCR-assisted receipt lands at the
  schema's default `VerificationLevel.UNVERIFIED` for free, with zero new
  code needed to enforce that ladder rule.
- **`tesseract.js@7.0.0`** added as a dependency (`package.json`) — no
  cloud OCR API, so no third-party account/key Omar would have needed to
  provision first; the whole OCR step runs offline in the browser.
- **6 new tests** (`receipt-ocr-parser.test.ts`, all against fixture text
  strings approximating real OCR output, not real images): merchant/total/
  items extraction from a plain US-style receipt, `$`-symbol currency
  detection plus confirming the total line itself never also gets read as
  a line item, European comma-decimal amounts with a `€` symbol, the grand
  total winning over a same-page subtotal line, and both "no amounts at
  all" and "empty/whitespace-only" inputs returning honest nulls/empty
  array rather than guessing. `npm run typecheck`, `npm run test`, and
  `npm run build` all pass.
- **No dedicated test for the OCR-triggering UI flow** (`handlePhoto`'s
  async OCR-then-prefill sequence, or `ReceiptForm`'s new banner) — same
  gap Session 4's follow-up already logged for this repo's Server
  Component pages: no frontend test harness exists yet. The parser this
  flow calls into is fully unit-tested (above); the UI wiring itself was
  not manually click-through-verified with Omar this session — flagging
  that honestly rather than claiming a check that didn't happen. Worth a
  click-through pass before this repo's next public deploy, the same way
  Session 4's upload UI was.
- **Full test suite flaked under heavy, unrelated system load while this
  session ran** (load average briefly above 35 on an 8-core machine, from
  several stray leftover `tsx watch` processes plus normal desktop apps —
  nothing to do with this session's code): confirmed by stashing this
  session's changes and re-running, which also failed the same way at
  peak load, and by a clean 82/82 pass once concurrency was reduced
  (`vitest run --maxWorkers=2 --testTimeout=20000`). Logged so a future
  session doesn't mistake a loaded machine for a real regression.

## Completed components (Session 5 follow-up — real-browser click-through, then a full OCR engine swap)

Same day (2026-08-12) as Session 5 itself. Omar ran the actual upload
flow against two of his own real, hard receipts (a 2014 Kohl's receipt —
old thermal paper, faded unevenly with age/handling — and a Brioche Doré
receipt), guided step by step (same "Chrome automation can't reach
localhost in this sandbox" gap every prior click-through here hit). This
found three genuine bugs in `receipt-ocr-parser.ts`, all fixed and
regression-tested against the *exact* real OCR text from both receipts:

1. **`guessMerchant` had no quality filter** beyond "not an amount, not
   pure digits" — a 2-character OCR misread of a border artifact (`": E"`)
   passed both checks and was returned as the merchant verbatim, just for
   being the first line. Fixed: requires 2+ consecutive letters
   (`LOOKS_LIKE_A_WORD`) before a line can be a merchant candidate.
2. **`AMOUNT_AT_END` required an exact end-of-line match** — real item
   lines routinely have a short trailing tax-category code after the
   price (`"... 4.00 T1"`), which silently failed to match, so `items`
   came back empty on real scans even when merchant/total worked. Fixed:
   tolerates up to 3 whitespace/`*` chars plus up to 4 trailing alnum
   chars after the amount.
3. **Exact keyword matching for "total" missed real OCR errors on that
   one word** — both receipts had Tesseract misread "Total" itself
   (`"Jotal"`, `"Tote."`) while reading the rest of the same line
   correctly, so `totalMinor` came back null (Kohl's) or silently wrong,
   pulled from an unrelated earlier line (Brioche's `"Jotal 1.23 $2.00"`,
   not the real total) instead of the actual total line. Fixed two ways,
   both in `guessTotalMinor`: (a) a length-gated Levenshtein-distance-≤2
   fuzzy match on "total" as a fallback tier, after the exact match finds
   nothing; (b) a narrow decimal-point-repair fallback
   (`CURRENCY_SPACE_DECIMAL_AT_END`) for when OCR drops the `.` entirely
   (`"$23 75"` → `2375`), requiring an explicit leading currency symbol
   so it doesn't start reinterpreting unrelated number pairs (dates,
   quantities) as money. 6 new tests (94 total, up from 88) lock in both
   real receipts as regression fixtures.

**What the click-through didn't fix, on purpose**: a genuine one-digit
Tesseract misread (`75` read where the receipt actually printed `45`) on
the Brioche receipt's total, caught by Omar during review, not by the
parser. No text-level heuristic can recover a character the OCR engine
itself read wrong — this is exactly the class of error the amber "please
review before saving" banner exists for, not a parsing bug. A third test
photo (a stock "Realistic receipt template" design graphic, confirmed by
Omar as not a real receipt) surfaced a real but out-of-scope formatting
gap — one-decimal-digit amounts (`"16.5"` instead of `"16.50"`) aren't
matched at all — deliberately not chased since the input wasn't
representative; logged here in case a real receipt ever uses that format.

**Then: swapped the OCR engine from Tesseract.js to a self-hosted service**,
at Omar's request after the click-through exposed Tesseract's
character-accuracy ceiling. This is a real architecture change, not a
drop-in library swap: the strongest fully open-source OCR engines (per a
benchmark check that day) are Python projects with no browser/WASM
runtime the way `tesseract.js` has.

- **PaddleOCR tried first** (~94.5% on OmniDocBench vs. Tesseract's ~92%,
  plus PP-StructureV3's table/layout awareness — relevant for a receipt's
  line-item structure specifically) — **abandoned after its official pip
  binaries crashed on this arm64 (Apple Silicon) dev machine under two
  different architectures**: native arm64 segfaults at import
  (`Segmentation fault`, exit 139) inside PaddlePaddle's compiled core;
  forcing `platform: linux/amd64` (Rosetta emulation, pulling PaddlePaddle's
  more mature x86_64 wheels) instead crashes with `Illegal instruction`
  (exit 132) the same way. Two different low-level native crashes under two
  different architectures is a real PaddlePaddle/ARM64 compatibility gap
  (a documented pain point in that community), not a config mistake worth
  chasing further — see `git log` around this commit for the abandoned
  PaddleOCR version of `ocr-service/` if that gap ever gets fixed upstream
  and this is worth revisiting.
- **Landed on Surya** instead (`surya-ocr`, PyPI) — PyTorch-based, and
  PyTorch has much more mature official ARM64 Linux wheels, sidestepping
  that whole class of problem. Nearly as strong on benchmarks, particularly
  good layout analysis. Verified its actual Python API (`surya.ocr.run_ocr`
  plus separate detection/recognition model loaders) directly against the
  installed package in a throwaway local venv before writing
  `ocr-service/main.py`, rather than guessing at a fast-moving project's
  API from memory.

  **⚠️ BLOCKING for commercial deployment, found in a 2026-08-12 review,
  not resolved — needs Omar's explicit decision before this goes anywhere
  near production.** The `surya-ocr==0.6.2` code itself is Apache-2.0, but
  the actual **model weights** it downloads and runs
  (`vikp/surya_det3`, `vikp/surya_rec2` — confirmed directly against
  HuggingFace's own model-card API, not assumed) are licensed
  **CC-BY-NC-SA-4.0** — non-commercial, no revenue/funding threshold, no
  carve-out at all. Receiptless's own ROADMAP.md has a whole "Commercial
  model" section (retailer API access, premium tiers, sponsors); using
  these specific weights commercially as currently wired up would violate
  that license outright. (Note this is stricter than newer `surya-ocr`
  releases, which moved to a modified OpenRAIL license with a ~$5M
  funding/revenue threshold — still not simply permissive, but not what
  this pinned version actually uses either way.) **Nothing has been done
  about this except documenting it here and in ROADMAP.md's "Post-
  production revisit list"** — no engine swap, no license negotiation.
  Fine for local prototyping (nothing is deployed, no real user data
  flows through it — this repo's own hard gate already blocks that), not
  fine to build further on without Omar reading this and deciding: accept
  the NC license for now and swap later, negotiate a commercial license,
  or move to a permissively-licensed engine (docTR — Apache 2.0 — is the
  most directly comparable option; see ROADMAP.md) before this goes any
  further.
- **`ocr-service/`** (new): a minimal FastAPI app (`main.py`) wrapping
  Surya's detection + recognition models behind one `POST /ocr` endpoint,
  returning newline-joined recognized text — the same "raw OCR text" shape
  Tesseract.js's `worker.recognize()` used to return, so
  `receipt-ocr-parser.ts` needed zero changes on the other side of this
  swap. `Dockerfile` pre-downloads Surya's model weights at build time (not
  on first request); needs `libgl1`/`libglib2.0-0` (OpenCV/Pillow's
  transitive chain) in the base image. `docker-compose.yml` gained an `ocr`
  service (port 8868, health-checked, 60s start period since model loading
  takes a while on first boot), running native arm64 — same "real service
  in local dev, faked in tests" convention as `minio`.
- **`src/lib/ocr-client.ts`** (new): `OcrClient` interface +
  `SuryaOcrClient` (real, calls the service over HTTP) +
  `getOcrClient`/`setOcrClient` injection seam — exact same shape as
  `storage.ts`'s `ObjectStorage`/`getObjectStorage`/`setObjectStorage`.
  `src/test/fake-ocr-client.ts` mirrors `FakeObjectStorage`.
- **New `POST /api/receipts/ocr` route**: session-gated (not receipt-
  ownership-scoped — there's no receipt yet at this point in the flow,
  same as before; the session check exists so unauthenticated traffic
  can't burn compute on a real, non-free service), reuses `storage.ts`'s
  `sniffImageContentType`/`MAX_IMAGE_BYTES` rather than duplicating that
  validation, returns 502 (not 500) if the OCR service errors/is
  unreachable — an expected operational state (a separate container that
  can be down), not a bug in this route. 6 new tests.
- **`src/lib/ocr.ts`** (rewritten): now a thin `fetch` call to the new
  route instead of running Tesseract.js in-browser — same
  `recognizeReceiptText(file): Promise<string>` signature, so
  `receipts/new/page.tsx` needed zero changes. `tesseract.js` removed
  from `package.json` (no longer used anywhere).
- **`OCR_SERVICE_URL`** added to `.env.example` (defaults to
  `http://localhost:8868`, matching `docker-compose.yml`, same convention
  as `S3_ENDPOINT` etc.).
- **94 tests total** (verified with a real `npm run test` run, not
  computed by hand — see IDent's own session-15 test-count correction for
  why that discipline matters). `npm run typecheck` and `npm run test`
  both pass without the real OCR container running (the fake client
  covers all automated tests, same as MinIO).

**Two more real problems building Surya's image, both fixed**:

1. **Plain `pip install torch` pulls the CUDA build by default on Linux**
   — several hundred MB to multiple GB of NVIDIA runtime libraries
   (`nvidia-cufft` alone was 214MB) a CPU-only container never uses,
   ballooning one build past 16 minutes before it was killed. Fixed:
   `Dockerfile` installs `torch<3.0.0` from PyTorch's own CPU wheel index
   (`--index-url https://download.pytorch.org/whl/cpu`, ~92MB) *before*
   `requirements.txt`, so surya-ocr's own `torch` dependency is already
   satisfied and pip never reaches for the CUDA variant.
2. **`surya-ocr==0.6.2` declares only `transformers<5.0.0,>=4.41.0`** — a
   loose enough range that an unpinned install resolved to whatever the
   latest `transformers` release currently is, which broke Surya's
   recognition-model config class (`KeyError: 'encoder'`, inside
   `transformers`' own config `__repr__`/logging path — a real version-
   drift incompatibility, not an environment issue). Fixed: pinned
   `transformers==4.45.2` in `requirements.txt` — the newest release that
   existed before `surya-ocr==0.6.2` itself shipped (2024-10-14, checked
   directly against PyPI's release metadata rather than guessed), almost
   certainly what it was actually built/tested against.

**A third, more serious bug found only by real end-to-end testing (not
unit tests) — real receipts don't round-trip through Surya the way they
did through Tesseract.js.** Sent a synthetic test receipt image
(`CORNER BAKERY` / `Croissant   4.50` / `Latte   5.25` / `Total   9.75`,
generated locally, not from a real photo) directly to the running `ocr`
container: Surya's own `text_lines` output split same-row text into
*separate* detected spans with no relationship to which row they came
from — `"CORNER BAKERY\nCroissant \n4.50\n5.25\nLatte\n9.75\nTotal"` —
completely unlike Tesseract's raster-order text, which happened to keep
"item name ... price" together on one line. Run through
`receipt-ocr-parser.ts` unchanged, this produced `totalMinor: null,
items: []` — the swap would have silently broken the feature's actual
suggestions while every automated test (all mocking the OCR client)
stayed green. Fixed in `ocr-service/main.py`, not the parser: each
`TextLine` carries its own bounding box (`.bbox`, unavailable from
Tesseract.js) — `group_into_rows` greedily clusters spans by vertical
(Y) overlap into rows, sorts each row's spans left-to-right, and joins
them with generous spacing, reconstructing the same "name    price"
layout the parser already expects. Re-tested against the same synthetic
receipt after the fix: `"CORNER BAKERY\nCroissant     4.50\nLatte
5.25\nTotal    9.75"` → `parseReceiptText` correctly returns `{merchant:
"CORNER BAKERY", totalMinor: 975, items: [{Croissant, 450}, {Latte,
525}]}`.
- **`Dockerfile` reordered** so `COPY main.py` happens *after* the model-
  preload `RUN` step, not before — that `RUN` command doesn't depend on
  `main.py` at all (only imports from `surya`), so the original order was
  invalidating and re-running the expensive model-download layer on every
  `main.py` edit. One-time cost to reorder (broke that layer's cache
  once); every iteration on `main.py` since has been fast.
- **Real end-to-end verification, done**: built and started the actual
  `ocr` container (arm64 native, no emulation needed), confirmed
  `/health` returns 200, sent the synthetic receipt directly to the
  container's own `/ocr` endpoint (bypassing Next.js) and separately
  through the real running dev server's actual
  `POST /api/receipts/ocr` route with a real registered session
  (bypassing the OCR-client fake entirely) — both paths returned the
  same correct, row-reconstructed text, which `receipt-ocr-parser.ts`
  turned into the correct suggestion. This is real, not the fake-client
  coverage the 94 automated tests provide.
- **Real-browser click-through with Omar, done, same day** — the same
  Kohl's receipt from Session 5's original click-through, this time
  through Surya. Two findings:
  1. **CPU-only inference is genuinely slow**: real requests took 83
     seconds and 2.6 minutes in the dev server's own logs; a small
     600×400 synthetic test took 2m37s. No GPU passthrough into the
     container on this dev machine. The UI's "Reading receipt…" state has
     no progress indicator, which could read as frozen on a slow request
     — worth a progress affordance before a real deploy, not fixed this
     session (flagged here rather than silently left).
  2. **Surya's actual accuracy on this exact receipt was dramatically
     better than Tesseract's** — recognized `"TOTAL    $0.52"` cleanly,
     something Tesseract never read as a whole word. But this surfaced a
     real parser bug, not an OCR one: the same receipt separately prints
     `"TOTAL SAVED: $52.50"` (a promotional discount-summary line) *after*
     the real total, and `TOTAL_LINE`'s bare `/\btotal\b/i` match didn't
     distinguish the two — the bottom-up scan in `guessTotalMinor` found
     "TOTAL SAVED" first and returned `$52.50` instead of the actual
     `$0.52` charged. Fixed: `NON_TOTAL_TOTAL_LINE` now also excludes
     "total saved"/"you saved"/"total savings" lines, same convention as
     its existing "subtotal"/"pre-tax" exclusions. One new regression test
     (95 total) against the exact real Surya output. Merchant still comes
     back as `"Lisbon"` (the town, not "Kohl's") — unchanged, not a bug:
     this specific receipt's OCR text genuinely never prints the brand
     name as its first line (confirmed both under Tesseract and Surya),
     a "first-line heuristic" limitation, not an OCR-quality one.

**Same-day follow-up: a real review of the Surya swap (2026-08-12) found
seven issues, six fixed same day, one (the license question above)
correctly left as a decision for Omar rather than silently worked around:**

1. **The OCR service was reachable from any host on the network, with no
   auth of its own.** `docker-compose.yml` published port 8868 on
   `0.0.0.0`; the Python service accepted unauthenticated uploads with no
   size/concurrency limit — anyone who could reach the machine could
   bypass `POST /api/receipts/ocr`'s session check entirely and trigger
   repeated 1-3-minute CPU-bound jobs. Fixed: bound to
   `127.0.0.1:8868:8868`. **Still not production-safe** — a real
   deployment needs this on a private network with no public port at
   all, not just loopback, plus real service-level auth.
2. **License question — see the Surya bullet above and
   `ROADMAP.md`'s "Post-production revisit list".** Deliberately not
   "fixed" — this is Omar's decision, not a bug to patch around.
3. **No request timeout, and the architecture doesn't fit measured
   latency.** `ocr-client.ts` had no timeout at all; a hung (not just
   slow) service would hold the connection open indefinitely, with real
   requests already measured at 1-3 minutes. Fixed a real bug on the way:
   `main.py`'s `/ocr` handler awaited Surya's blocking `run_ocr` call
   directly, which blocked FastAPI's single event loop for the *entire*
   inference — even `/health` couldn't respond mid-request (confirmed:
   before the fix, a concurrent `/health` call didn't return until the
   OCR request finished; after, it returned in 158ms while an OCR request
   was actively running). Fixed by running inference in a worker thread
   (`loop.run_in_executor`) behind a concurrency-limiting semaphore, and
   added a 5-minute hard client-side timeout
   (`AbortSignal.timeout`) as a backstop. **Still not what a real
   production deployment needs**: this review's own suggested design
   (upload → create job → `202` + job id → client polls/SSE for status)
   is a genuinely different, bigger architecture — synchronous
   request/response, even non-blocking, still doesn't fit a reverse
   proxy's or serverless platform's typical request-timeout ceiling.
   Not built; flagged here for whenever a real deploy target exists.
4. **The Python service trusted the Next.js route's validation instead
   of enforcing its own.** Fixed: `main.py` now independently checks
   request size (matching `storage.ts`'s 8MB `MAX_IMAGE_BYTES`), decoded
   image format (JPEG/PNG/WEBP only, checked after `Image.open()`, not
   trusted from any client-supplied header), and a 20-megapixel dimension
   cap — deliberately tighter than Pillow's own built-in decompression-
   bomb ceiling (`Image.MAX_IMAGE_PIXELS`, ~178M pixels by default) so an
   oversized image is rejected cheaply (dimensions are read from the file
   header, no full decode needed) before the expensive `.convert("RGB")`
   step ever runs.
5. **`group_into_rows` (the row-reconstruction fix from earlier in this
   same session) had zero test coverage**, and writing tests for it
   surfaced a real bug matching exactly what the review predicted: the
   original `overlap / min(heightA, heightB)` ratio let an unusually tall
   span (a rotated barcode fragment, a multi-line detection glitch)
   trivially "overlap enough" with any short row it merely touched, then
   drag that row's own Y-range wide enough to spuriously absorb a second,
   genuinely unrelated row too. Fixed: switched to an overlap-over-*union*
   (IoU-style) ratio, which stays correct for same-sized spans (verified
   against the real Kohl's/Brioche/synthetic cases already in the
   pipeline) while no longer letting a much-taller span bridge two
   distinct rows. Extracted into its own `ocr-service/row_grouping.py` —
   zero ML dependencies, so it imports and runs in milliseconds — with 9
   new pytest tests (`ocr-service/tests/test_row_grouping.py`): shuffled
   left/right spans, slight vertical misalignment, adjacent rows (both a
   clean gap and a thin real overlap), the tall-span-bridging regression
   itself, a denser 5-row stress case, and empty input. Not wired into CI
   (same convention as the TS side's fake-client tests) — run manually via
   a local venv (`cd ocr-service && python3 -m venv .venv && source
   .venv/bin/activate && pip install pytest && python3 -m pytest tests/`).
6. **Fuzzy "total" matching could produce a plausible-looking false
   total.** Confirmed directly: `levenshtein("local", "total") == 2`, the
   same threshold already accepted for real OCR errors like "Jotal" — a
   line like `"Local 9.99"` could have been mistaken for the total on a
   receipt with no real total/amount-due line. Fixed: the fuzzy-match
   fallback tier now also requires a currency symbol on the line — both
   real cases this fallback exists for (`"Jotal 1.23 $2.00"`,
   `"Tote. $23 75"`) already have one, so this costs nothing on real
   input while meaningfully narrowing the false-positive surface. Two new
   tests (the negative case and a positive control) — **97 tests total**.
7. **Stale doc/comment references to "PaddleOCR" as the landed engine**
   (`RECEIPTLESS_STATE.md`'s own header, `fake-ocr-client.ts`) — both
   corrected to say Surya; historical mentions of PaddleOCR being tried
   and abandoned were already accurate and left as-is.

All of the above independently re-verified against the real running `ocr`
container after the fixes (not just the fake-client-backed 97 automated
tests): rebuilt (instant, thanks to the earlier Dockerfile layer reorder
— only the changed `.py` files needed recopying), confirmed loopback-only
binding via `docker port`, confirmed `/health` responds in ~150ms during
an active OCR request (the event-loop fix), and re-ran a synthetic
receipt through the full pipeline end to end with a correct result.

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

4. ~~**Real object storage for photos (S3/R2)**~~ — done (see "Completed
   components (Session 4)" above): `imageKey` on `Receipt`, owner-scoped
   upload/fetch routes, signed URLs only, content sniffed from magic
   bytes, tenant-isolation tests, manually verified against real MinIO.
   **Still needs Omar** for an actual production deployment: a real S3/R2
   bucket + credentials (local dev/CI use MinIO/a fake, per above) — not
   a blocker for anything before Session 8's hosting work.

5. ~~**OCR on photo uploads.**~~ — done (see "Completed components
   (Session 5)" above): client-side Tesseract.js (`src/lib/ocr.ts`)
   feeding a pure, unit-tested heuristic parser (`src/lib/
   receipt-ocr-parser.ts`) that suggests merchant/total/currency into
   `ReceiptForm` via a reviewable amber banner — never silently
   auto-filled and submitted, and every OCR-assisted receipt still lands
   at `VerificationLevel.UNVERIFIED` by construction (the create schema
   has no field for a client to claim otherwise). Item-level suggestions
   are parsed (`OcrReceiptSuggestion.items`) but not yet wired into the
   form's UI — `ReceiptForm` only has merchant/amount/currency/category/
   date fields today, no per-item entry at all; revisit once the form
   grows one. 6 new tests. **Not yet browser-click-through-verified** —
   see "Completed components (Session 5)" above.

6. ~~**Email ingestion, path A: forward-to address.**~~ Done 2026-08-13:
   provider-neutral normalization/ingestion with a Postmark adapter,
   per-user opaque forwarding tokens, HTTP Basic webhook authentication,
   owner-scoped `EMAIL` / `IMPORTED` receipts, and retry idempotency.
   **Still needs Omar for production activation:** domain, Postmark account,
   public HTTPS webhook, deployment IP allowlisting, and real delivery
   click-through. The original scope follows for context. The simplest path
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

7. ~~**Per-retailer parser adapters.**~~ Done 2026-08-13, built
   **format-keyed rather than brand-keyed** (decided with Omar — see this
   file's header for why). `src/lib/receipt-adapters/`: a registry that
   dispatches on structure to one of three adapters — `order-summary`
   (itemized e-commerce confirmation, labelled grand total, real
   quantities), `key-value` (single-charge ride/fuel/subscription receipt,
   explicitly *no* line items so a total row can't become a phantom item),
   and `pos-slip` (the fallback, bridging to `receipt-ocr-parser.ts` so
   unstructured receipt text has one parser regardless of whether a photo
   or an email produced it). Also closed two real gaps: purchase date now
   comes from the email (printed date, else the `Date` header, with
   future/implausible dates rejected) instead of the ingestion clock, and
   `InboundEmailDelivery.adapterId` records which adapter parsed each
   delivery. 25 new tests (136 total). **Open, deliberately deferred:**
   fixtures are synthetic, not real anonymized receipts (see header) —
   revalidate and tune `detect()`/`parse()` against Omar's genuine receipt
   mail in a future session, and replace the synthetic fixtures rather than
   adding more beside them. A brand-specific adapter, if one is ever
   genuinely needed, goes at the *front* of `registry.ts`'s array.

8. ~~**Hosting: Vercel + hosted Postgres.**~~ Code-side prep done
   2026-08-13; **the accounts themselves still need Omar**, so nothing has
   been deployed and nothing here is verified against real hosting. Built:
   `vercel.json` (migrations run in the build, security headers),
   `src/lib/deployment.ts`, an `/api/health` readiness endpoint that lists
   every missing config key at once without exposing a single value, and
   `DEPLOYMENT.md` as the runbook. The important part is the gate the
   original entry asked for: `/api/merchant/receipts` is unauthenticated
   and unrate-limited, and its "local/demo only" status was just a doc
   comment — it is now **off by default in any deployed environment**
   (Vercel previews included, since those are public too), returns 404
   rather than advertising itself, and fails closed on anything other than
   the exact string `true`. Original scope follows.

   **Hosting: Vercel + hosted Postgres.** Not first despite ROADMAP.md
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

9. ~~**Email ingestion, path B: Gmail/Outlook OAuth scan.**~~ Done
   2026-08-13 for Gmail. OAuth connect with PKCE and `gmail.readonly`
   scope only, AES-256-GCM token storage in one opaque column, refresh
   with a buffer, and a disconnect that clears token material outright
   rather than flipping a status. Scanned mail reuses the *existing*
   pipeline — `ingestEmailForUser` was extracted from Session 6's
   webhook path so both connectors share idempotency, merchant-metadata
   protection, and trusted-clock dating, and `htmlToText` moved to its own
   module so both flatten HTML identically. All three tests the original
   entry asked for are covered: token refresh (including refresh-token
   rotation and no-rotation), a disconnected account no longer being
   scanned, and per-message failure isolation. **Not verified against real
   Google credentials** — no OAuth client exists yet, so everything is
   tested against a fake API client, and the redirect URI currently points
   at localhost since Session 8's hosting doesn't exist either. Outlook is
   not built; the connector interface is Gmail-shaped but the ingestion
   core it feeds is provider-neutral. Original scope follows.

   **Email ingestion, path B: Gmail/Outlook OAuth scan.** The second half
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

**Phase 1 is now code-complete (2026-08-13).** Two real-world gaps remain
and neither is a coding task: no deployment exists (Session 8's accounts
need Omar) and no Google OAuth client exists (Session 9's credentials need
Omar). Both sessions are built and tested up to exactly the line where a
real account is required, and neither is claimed as verified against real
infrastructure.

## Objective 0 — land the review stack (DONE, 2026-08-14)

Sessions 6-9 are on `main` at `ec77974`, CI green. Kept here rather than
deleted, for the merge lesson below.

**A stacked merge does not do what the merge order implies.** All three
PRs were merged within eight seconds of each other and GitHub reported all
three as `MERGED` — while `main` contained only #1. GitHub retargets a
stacked PR's base to `main` only when the previous base branch is
*deleted*, and that is asynchronous, so #2 merged into
`agent/forwarded-email-ingestion` and #3 into
`agent/retailer-parser-adapters`: each one level up the stack, exactly as
its base said. Nothing was lost — the cascade left
`agent/retailer-parser-adapters` holding every PR head — and `main` was
repaired by merging that branch directly (`ec77974`), whose tree was
verified identical to it beforehand.

**Next time, either** delete each base branch and wait for GitHub to
retarget the next PR before merging it, **or** skip the ceremony and merge
the top of the stack into `main` once. The failure is quiet: eight green
merged PRs, a `main` that is missing almost all of them, and a progress
badge still reporting the pre-stack number.

### Review findings, since this is where the stack was reviewed

- The question this file posed on PR #3 — does the readiness gate in
  `deployment.ts` cover every path to `oauth-token-crypto.ts`? — is
  answered **yes, and the gate is not what does the work**:
  `resolveEncryptionKey` fails closed at the point of use, so no path
  encrypts a real refresh token under the committed dev key even if
  `/api/health` is never called.
- One real bug found and fixed (`e60702d`): `insecureProductionConfig`
  rethrew anything that was not an `InsecureEncryptionKeyError`, so a
  wrong-length key — the likeliest operator typo — made `/api/health`
  answer 500 with no key name instead of the 503 naming the key. The
  endpoint that diagnoses misconfiguration was the one thing a
  misconfiguration took down.
- Residual assumption, not a bug: `isDeployedEnvironment` is
  `VERCEL_ENV || NODE_ENV === "production"`. That covers Vercel and
  `next start`. A self-hosted deploy setting neither would be treated as
  local and would use the committed key. State this in DEPLOYMENT.md if
  the hosting target ever stops being Vercel.

### Merge in order — each is based on its predecessor, not on `main`

| PR | Focus of review | Est. |
| --- | --- | --- |
| [#1](https://github.com/OmarMoawad/receiptless/pull/1) — forwarded-email ingestion | The opaque plus-address scheme and how a delivery is routed to an owner | ~10 min |
| [#2](https://github.com/OmarMoawad/receiptless/pull/2) — parser adapters | **Carries a security fix.** The email `Date` header was being used as the clock that validated dates, so a spoofed header authorised itself. Check the trusted-clock split in `receipt-adapters/registry.ts` | ~15 min |
| [#3](https://github.com/OmarMoawad/receiptless/pull/3) — hosting prep + Gmail scan | **Read this one closely.** Carries the committed-encryption-key fix. The question worth answering: does the readiness gate in `deployment.ts` cover *every* path a deploy could take to reach `oauth-token-crypto.ts`? | ~25 min |

Merging out of order will create conflicts, because each branch is based on
the one before it rather than on `main`.

### Done when — all met except one

- [x] All three merged and `main` contains them — verified by ancestry,
      not by GitHub's `MERGED` label, which was wrong here
- [x] CI green **on `main`** (`ec77974`)
- [x] Worktrees and local branches deleted
- [ ] **The three remote `agent/*` branches still exist** — deleting them
      needs Omar; the agent's permissions stop at local deletion
- [x] `docs/progress.svg` regenerated from `main` — already current at
      22%, no diff

## Session 10 — one production-like vertical slice (after Objective 0)

Inserted ahead of the Phase 2 cadence below on CTO review, 2026-08-13. The
instruction was explicit: **pause new surface area until one production-like
vertical slice is exercised.** Phase 2's five sessions do not start until
this one is done.

The reasoning is hard to argue with. This repo has accumulated 200 tests
and nine sessions of features without a production-like environment or a
single real OAuth integration. Every external dependency is exercised
against a fake. More tested code on that foundation compounds risk rather
than reducing it.

### Part A — no accounts needed, can start immediately (DONE, 2026-08-14)

Both items below are done. The result is the "Evidence ledger" section
further down, plus a corrected test count (188 → 201, the old figure was
carried forward unchecked) and a "Next task" section that had been stale
at Session 6 since three sessions before.

1. ~~**Scope every evidence claim in the docs.**~~ Replace bare "proven" and
   "verified" with what was actually demonstrated, on what, at which
   commit — e.g. "exercised against local Postgres at `b5cc264`", not
   "proven". The CTO's point stands: an unscoped claim is weaker than a
   narrow one, because a reader cannot tell what it covers.
2. ~~**Attach traceable evidence.**~~ Every status or numeric claim gets a
   durable link — CI run, PR, commit SHA, test log. "Green" is
   time-sensitive; record the head SHA and the timestamp it was checked.

### Part B — needs Omar's accounts

3. **Real Google OAuth client.** Highest-leverage credential in either
   repo: one client unblocks this repo's Gmail scanner *and* IDent's Gmail
   and Calendar sync. Until it exists, the second ingestion path is
   theory.
4. **Deploy.** Vercel project plus hosted Postgres, per DEPLOYMENT.md. The
   runbook, `vercel.json`, and `/api/health` are written and have never met
   real infrastructure.
5. **The slice itself, end to end with real data:** connect a real Gmail
   account → scan → a real receipt lands in the vault → it is searchable.
   One path, working in production, beats five more sessions of code.

### Exit criteria — all of these, not a subset

The CTO named the pieces that make a slice "production-like" rather than
merely deployed. A deploy that lacks these is not this session's goal:

- **Real identity and OAuth** — a genuine Google account, not a fake client
- **Secret management** — no secrets in the repo or in build logs; the
  `EMAIL_OAUTH_ENCRYPTION_KEY` gate verified against the real environment
- **Observability** — error tracking and a log drain, so a production
  failure is visible without SSH
- **Rollback** — documented *and rehearsed at least once*, not just written
- **Readiness checks** — `/api/health` exercised against the real database
  and returning the expected shape
- **Migration procedure** — run as a release step against the real
  database, since migrations were deliberately taken out of the build

### Deliberately still open

The Surya OCR service has no hosting story and is **out of scope here** —
photo OCR will not work in this slice, and that is an accepted limitation
of a deliberately narrow first deployment rather than an oversight.

## Evidence ledger (Session 10 Part A, 2026-08-14)

Every status claim in this file should be checkable by someone who does
not trust it. The CTO's point in the Session 10 brief: an unscoped claim
is *weaker* than a narrow one, because a reader cannot tell what it
covers. "Green" and "proven" are time-sensitive and unfalsifiable
respectively; a SHA and a run id are neither.

**The standing rule for this repo:** a status or numeric claim carries
what was demonstrated, on what, at which commit, and when it was checked.
If it cannot carry that, it is written as unverified.

### What is verified, and exactly how far

| Claim | Evidence | Scope — what it does *not* cover |
| --- | --- | --- |
| Test suite passes | **201 tests, 27 files, 0 failures.** `npm test` on branch `agent/session-10-evidence`, base `6e179d2`, run 2026-08-14 19:07–19:08 local, against local Postgres 16 on `localhost:5433` from `docker-compose.yml`. Independently confirmed by CI run [31820460320](https://github.com/OmarMoawad/receiptless/actions/runs/31820460320), conclusion `success`, checked 2026-08-14. | Local machine plus one CI run. Synthetic fixtures throughout. Says nothing about real Gmail, real Postmark, or any deployed environment. |
| CI is green on `main` | Run [31776002762](https://github.com/OmarMoawad/receiptless/actions/runs/31776002762), conclusion `success`, head `6e179d22`, checked 2026-08-14 19:05 local. | A point-in-time observation of one run on one SHA. Not a claim about `main` at any later commit. |
| Phase 1 stack is on `main` | PRs [#1](https://github.com/OmarMoawad/receiptless/pull/1), [#2](https://github.com/OmarMoawad/receiptless/pull/2), [#3](https://github.com/OmarMoawad/receiptless/pull/3), [#4](https://github.com/OmarMoawad/receiptless/pull/4) — all merged; `main` at `6e179d22d4162a81ea4ccbc88fa24730daae0260`, 2026-08-14 09:21:28 +0300. | Verified by ancestry, **not** by GitHub's `MERGED` label — that label lied about this exact stack once already (see Objective 0). |
| Email ingestion works | Automated tests against hand-written fixtures. | **No real Postmark account, domain, or inbound webhook has ever delivered a message to this code.** |
| Gmail OAuth scanning works | Automated tests against a fake API client. | **No Google OAuth client exists.** Nothing in this path has met Google's real API. |
| Surya OCR beats Tesseract | One real-browser click-through on one real Kohl's receipt, session 5 follow-up. | A single receipt, one engine comparison, one machine. Not an accuracy benchmark. |

### Not verified, and not claimed to be

- **Nothing is deployed.** `vercel.json`, `/api/health`, and
  `DEPLOYMENT.md` have never met real infrastructure. The rollback
  procedure is written and **not rehearsed**.
- **No secrets management exists** beyond a local `.env`.
- **No observability**: no error tracking, no log drain.
- **The OCR service has no hosting story** — out of scope for the first
  slice, by decision, not by oversight.

### A worked example of why this matters, from today

At 18:55 a full run of this suite reported **76 failures across 17
files**. Nothing was wrong with the code. A benchmark running in the other
repo had exhausted this 8 GB machine's memory and killed the Docker
daemon, taking Postgres with it; every failure was `ECONNREFUSED` on
`5433` wearing a Prisma stack trace. Restarted, the same tree at the same
commit ran 201/201 green.

Had "76 failures" been recorded as a result rather than investigated, it
would have entered this file as a regression that never existed. This is
the second-order reason the ledger names its conditions: a number without
its environment is not a measurement.

## Session 10 Part B progress (2026-08-15) — code half done, accounts pending

Providers chosen with Omar, 2026-08-15: **Neon** (Postgres, branching
suits per-preview databases), **Cloudflare R2** (object storage, no egress
fees on receipt images), **Sentry** (error tracking). Inbound email stays
deliberately out of this slice — it needs a domain, and Session 10's point
is *one* path working end to end.

### Done, and exercised

**Error tracking (`src/lib/observability.ts`).** The wiring is the small
part; the scrubbing is the point. This app holds purchase history, so
Sentry's defaults — request bodies, cookies, headers, query strings — are
all unacceptable unfiltered. The posture is deny-by-default: bodies and
cookies deleted outright, headers **allowlisted** to three, query values
replaced with `<redacted>` while keeping key names, users reduced to an
opaque id with email and IP dropped, breadcrumbs redacted, and
`sendDefaultPii: false` asserted in a test rather than left to a library
default. Session Replay is deliberately **not** enabled: it captures the
rendered DOM, so it would record the receipt vault itself and no
event-level scrubbing would help. 18 tests cover the scrubber.

The SDK is inert without a DSN and disabled outside deployed environments,
so local development and CI never post to a shared tracker.

**Readiness reports observability.** `/api/health` now carries
`errorTrackingEnabled`. It deliberately does *not* fail readiness on it —
a deployment without error tracking is worse-operated, not unsafe to
serve, and conflating those would 503 every fork and preview.

**Verification script (`scripts/verify-deployment.mjs`).** Twelve
automated checks against a live deployment: readiness shape, database
reachability, the encryption-key gate, missing config, merchant endpoint
returning 404 *from outside*, error tracking active, HTTPS and HSTS, and
that the endpoint leaks no configuration values. It prints the four checks
it **cannot** make from outside — backups, log drain, real consent,
rollback rehearsal — so a green run never quietly means "verified except
the hard parts".

**Rehearsed locally against a production-mode build**, 2026-08-15, base
`0caae7c`, `VERCEL_ENV=production` on `localhost:3100` against local
Postgres:

- With the committed dev key: `insecureConfig: ["EMAIL_OAUTH_ENCRYPTION_KEY"]`,
  HTTP 503. **The gate fires.** This is the exit criterion about the
  encryption key, demonstrated rather than asserted.
- Fully configured: `status: "ok"`, both arrays empty,
  `merchantApiEnabled: false`, `errorTrackingEnabled: true`, HTTP 200.
- `verify-deployment.mjs` then passed 10/12; the two failures were HTTPS
  and HSTS, correct for `http://localhost` and expected to pass on Vercel.

**Rollback procedure written and made rehearsable** (`DEPLOYMENT.md` §7),
including the part that matters more than the button: promoting an old
build does **not** roll back a migration. Additive migrations are safe to
roll back under; destructive ones are not, and the fix is splitting them
across two releases rather than improvising a down-migration during an
incident.

### Two things the rehearsal found

- **The Gmail variables are one all-or-nothing group, and the encryption
  key is in it.** Setting only `EMAIL_OAUTH_ENCRYPTION_KEY` — the natural
  first move, since it is the one you generate yourself — makes
  `/api/health` 503 listing the three Google variables as missing. Correct
  behaviour, confusing symptom; now called out in DEPLOYMENT.md.
- **The Gmail OAuth start route is a POST, not a GET.** The first draft of
  the verification script sent GET, got 405, and counted it as a pass —
  which would have hidden a genuinely broken route. Fixed.

### Not done — needs Omar, and not claimed otherwise

1. **Accounts**: Neon, Cloudflare R2, Vercel, Google Cloud OAuth client,
   Sentry. Step-by-step in `DEPLOYMENT.md` and the setup runbook. I cannot
   create accounts, accept terms, or enter credentials.
2. **Nothing is deployed.** Every claim above is from a local
   production-mode build. `vercel.json` and `/api/health` still have not
   met real infrastructure.
3. **Rollback is rehearsable but NOT rehearsed.** The criterion says
   *rehearsed at least once*, so it is **not met** until the state file
   records two SHAs and an elapsed recovery time. Do it while the database
   is still empty and a mistake costs nothing.
4. ~~**Backups/PITR unconfirmed**~~ — **resolved 2026-08-15**: confirmed
   at **6 hours**, with the standing decision recorded in "Backup posture
   — confirmed, and thin". The entries above are kept as the record of
   what was true at the time; read the Backup posture section for current
   state.
5. **The real slice is unproven**: no Google account has completed
   consent, and no real receipt has landed in the vault from a real
   mailbox.

**Verified this session:** 219 tests across 28 files, all passing (201 →
219 with the observability suite), typecheck clean, `next build` clean
with the Sentry wrapper, on branch `agent/session-10-part-b`, base
`0caae7c`, 2026-08-15 against local Postgres 16 on `localhost:5433`.

## Session 10 Part B — deployed and verified (2026-08-15)

**receiptless is deployed and serving from real infrastructure**:
https://receiptless-theta.vercel.app — Vercel (fra1), Neon Postgres in
`eu-central-1` (pooled connection), Cloudflare R2, Sentry.

### Verification — 12/12 automated checks

`node scripts/verify-deployment.mjs https://receiptless-theta.vercel.app`,
run 2026-08-15 17:17Z against the deployment built from `703e25f`:

```
status: "ok", database: "ok", missingConfig: [], insecureConfig: [],
merchantApiEnabled: false, errorTrackingEnabled: true          HTTP 200
```

Every one of these was previously asserted from a local build and is now
demonstrated against the public internet:

- **Database reachable** from the deployment — Neon, pooled, over TLS.
- **The encryption-key gate is satisfied.** `insecureConfig` is empty, so
  the committed dev key is not in use. Before the real key was set, the
  live deployment reported exactly `insecureConfig: ["EMAIL_OAUTH_ENCRYPTION_KEY"]`
  and refused readiness with a 503 — the gate was observed *firing in
  production*, not only in a local simulation.
- **The unauthenticated merchant endpoint returns 404 to the public
  internet.** Confirmed by an actual `POST` from outside, not by trusting
  the flag the health endpoint reports about itself.
- **The readiness endpoint leaks no configuration values.**
- **HSTS**: `max-age=63072000; includeSubDomains; preload`, set by Vercel.

### Rollback — rehearsed, not just documented (2026-08-15 17:20Z)

The criterion required this be performed once. It was, on the live
deployment, while the database was still empty:

| Step | Measured |
| --- | --- |
| Promote previous deployment | rollback visible in **under 5 s** (first poll already showed it) |
| Rolled-back state | `HTTP 503`, `database: unreachable`, all config missing — correctly reported as unfit to serve |
| Promote good deployment back | **42 s** from click to `status: "ok"`, by polling every 5 s |

**42 seconds is the real recovery time.** That is the number worth knowing
before an incident rather than during one.

Two things this rehearsal establishes: promoting an older deployment takes
effect essentially instantly, and `/api/health` *detects* the rollback
rather than silently serving a broken app. Together those are what make
"promote the last good deployment" a recovery procedure.

**What it did not test, and is not claimed:** both deployments were builds
of the same commit differing only in environment configuration, so this
exercised neither a code difference nor — more importantly — a migration
boundary. The genuinely dangerous case, old code meeting a newer schema,
remains unexercised. That case is now *prevented* rather than rehearsed:
`npm run check:migrations` runs in CI and fails on destructive migrations.

### Still open

- **Log drain** — not configured. Session 10 names error tracking *and* a
  log drain; only the first exists. Error tracking is live
  (`errorTrackingEnabled: true`).
  **→ Superseded 2026-08-15**: established as *unmet and unmeetable on
  this plan* — Vercel Drains are Pro-only. See "Log drain — not met".
- **Backups/PITR retention window** — not yet confirmed in the Neon
  dashboard, so the hard gate below is **not** satisfied and no real
  receipt data should be treated as durable until it is.
  **→ Superseded 2026-08-15**: confirmed at **6 hours**. See "Backup
  posture — confirmed, and thin".
- **The slice itself** — no real Gmail account has completed consent, and
  no real receipt has been imported from a real mailbox. Everything above
  is the scaffolding for that path, not the path.
- **OCR** — the Surya service has no hosting story and is not part of this
  deployment. Photo OCR does not work in production, by decision.

## Session 10 — COMPLETE. The slice works end to end (2026-08-15)

**A real Gmail account connected to the production deployment and 25 real
receipts landed in the vault.** That is the thing nine sessions of tested
code were scaffolding for, and it is now done rather than described.

```
Gmail connected: okamel1000@aucegypt.edu
Scanned 25 message(s): 25 receipt(s) imported, 0 already known, 0 failed
```

Receipts render in the vault and are searchable. Production:
https://receiptless-theta.vercel.app — Vercel (fra1), Neon `eu-central-1`
pooled, Cloudflare R2, Sentry. 12/12 automated checks.

### What the slice cost, and what that says

Getting one path working in production surfaced **seven** defects, none of
which any test suite in this repo could have found, because all 219 tests
called the API directly:

1. **A destructive migration already in history** — `20260811201429_add_receipt_image_key`
   drops a column and adds another in one migration, the exact pattern
   DEPLOYMENT.md warns against. Now allowlisted with reasoning and blocked
   in CI by `npm run check:migrations`.
2. **`neonctl init` would have pointed the destructive test suite at
   production.** It writes the production `DATABASE_URL` into `.env`, and
   this suite deletes data. Guarded by `src/test/guard-local-database.ts`.
3. **No sign-in UI existed at all.** Two pages said "Sign in" and nothing
   rendered a form; there was not one password input in the codebase. The
   application was unusable by any human.
4. **No Gmail UI existed either.** Session 9 shipped the entire OAuth
   backend — PKCE, encrypted tokens, refresh, disconnect, scanning — with
   zero interface. Not one occurrence of "gmail" in any component.
5. **No git commit identity was configured**, so every commit was authored
   to a nonexistent address and Vercel refused PR previews. Masked for
   nine sessions because merge commits are authored by GitHub.
6. **The Gmail callback discarded its errors** in a bare `catch {}`. The
   first live failure left no evidence anywhere.
7. **Credentials were wrong twice** — client ID, then client secret — and
   only the last one was diagnosable, because by then the callback
   reported to Sentry.

Findings 3 and 4 share one root cause worth stating plainly: **a suite
that calls endpoints cannot tell you the endpoints are unreachable.**
Session 9 reported itself complete with 188 passing tests while shipping
something no user could reach. Twice.

### Observability proved itself, and my earlier claim was too generous

I recorded observability as "met" when Sentry existed. That was wrong in a
way worth naming: Sentry existing is not the same as the paths most likely
to fail reporting to it. The Gmail callback — the single most failure-prone
path in the product — swallowed its errors entirely.

Once wired, it paid for itself immediately. `Google API request failed with
status 401` on `GET /api/email/connections/gmail/callback`, release
`4c82a42f249e`, environment production — which identified a bad client
secret in one line, after I had guessed wrong twice from outside.

### Known gap: parse quality on real mail is poor

Import succeeded mechanically — 25/25, no failures — but the *data* is
weak, and this is the first look at real receipts rather than fixtures:

- **Merchant names mostly missing.** Only "Talabat" resolved; the rest
  display the date (`Aug 15, 2026`) where a merchant should be.
- **At least one zero total** — Talabat imported at `$0.00`.
- **Everything categorised `OTHER`.**

The adapters were built and tested against hand-written synthetic
fixtures, which is exactly the limitation flagged in the evidence ledger.
Real Egyptian receipt mail — Talabat and similar — does not match them.
Worth a Phase 2 session of its own; not a blocker for the slice, which was
about proving the *path*.

### Still open

- **Log drain — NOT MET, blocked on Vercel plan tier.** Checked directly
  in the dashboard, 2026-08-15. The Sentry integration *is* installed on
  the team, but `receiptless` → Settings → Drains reports **"No drains are
  associated with this project"**, and **Add Drain** is disabled with
  "Upgrade your plan to enable Drains" — log drains are a **Pro** feature
  and this account is on **Hobby**. Not resolvable by configuration; it
  needs a paid plan, which is Omar's call and was not taken.
- **Backups/PITR retention window** — still unconfirmed in the Neon
  dashboard. The hard gate below is therefore **not satisfied**, and 25
  real receipts now exist in that database. This is the most pressing
  remaining item.
- **OCR** — no hosting story; photo OCR does not work in production, by
  decision.

## Log drain — not met, and why that is the honest answer (2026-08-15)

Session 10's observability criterion names two things: **error tracking**
and **a log drain**. One is met and has proved itself; the other cannot be
met on this account's plan.

**Error tracking: met, and demonstrated.** Sentry is live in production,
scrubbing receipt data before events leave the process. It earned the
criterion the same day by identifying a bad Google client secret from a
single captured event — `Google API request failed with status 401` on the
Gmail callback — after two wrong guesses from outside.

**Log drain: not met.** Verified in the Vercel dashboard rather than
assumed:

- Sentry's Vercel integration **is** installed on the team.
- `receiptless` → Settings → Drains: **"No drains are associated with this
  project."** Installing the integration created none.
- **Add Drain** is disabled, tooltip *"Upgrade your plan to enable
  Drains"*, panel reads *"Upgrade to Pro to create your first Drain."*

So this is a **plan-tier limitation on Hobby**, not a misconfiguration.
Upgrading is a purchase and Omar's decision; it was not made, so the
criterion stands as unmet rather than being quietly redefined into
something the account can satisfy.

**What is lost by not having it:** Sentry sees anything that *throws*. A
drain would cover what does not — a function that times out, a request
that hangs, a deploy-time failure, or the platform logs around an incident.
Today's `console.error` in the Gmail callback goes to Vercel's built-in
runtime logs, which are short-retention and have no alerting. That is a
real gap and not a substitute.

**When to revisit:** before real users depend on this, or the first time
an incident is not explicable from Sentry alone. Not urgent for a solo
project with 25 test receipts and a 6-hour backup window.

**Process note.** This item was recorded earlier today as "installed,
delivery unverified" specifically because installing an integration is not
the same as logs arriving. That caution was correct — the integration had
in fact created nothing. Worth remembering the next time an install step
looks like completion.

## Backup posture — confirmed, and thin (2026-08-15)

**Neon history retention on this project is 6 hours.** Checked in the Neon
console, 2026-08-15. The hard gate below required this be *confirmed*
before real data, not that it be long — so the gate is now satisfied. What
it buys is worth stating plainly rather than filing as "backups: yes".

**What 6 hours covers:** a bad migration or an accidental delete you
notice and act on the same working session. Point-in-time restore to any
moment inside that window.

**What it does not cover:** anything noticed the next morning. A delete at
23:00 is unrecoverable by 06:00. There is no daily snapshot behind it on
this tier — 6 hours is the whole safety net.

**Not tested.** A restore has never been performed. The retention *window*
is confirmed; the ability to actually restore from it is not, which is the
same distinction this repo keeps having to make between a documented
procedure and a rehearsed one. Rolling back a deployment was rehearsed
(42 s, see above); restoring the database has not been.

**Standing decision:** acceptable while the database holds 25 test
receipts imported from one mailbox. **Revisit before this holds data whose
loss would matter** — either extend retention on a paid tier, or add an
independent periodic dump, and rehearse a restore once either exists.

## Session cadence for Phase 2 — re-baselined 2026-08-13

Phase 2 is "vault maturity" (ROADMAP.md): making what's already captured
genuinely useful, rather than capturing more of it. Ordered so each
session stands alone.

**Session 1 is the exception to that** — it is the one item that needs
Omar's card rather than an agent's time, and it is deliberately first
because it closes the only Session 10 exit criterion that went unmet.

1. **Upgrade Vercel to Pro, and finish the observability criterion.**
   **Decided 2026-08-15, first item of the milestone.**

   Session 10 required error tracking **and** a log drain. Error tracking
   is live and proved itself the day it landed, naming a bad Google client
   secret from a single captured event after two wrong guesses from
   outside. The drain is unmet and **not fixable by configuration** —
   Vercel Drains are a Pro feature and this account is on Hobby, verified
   in the dashboard (Add Drain disabled, *"Upgrade your plan to enable
   Drains"*).

   **Needs Omar**: the upgrade itself is a purchase (~$20/month at time of
   writing). Nothing else in this session can start until it exists.

   Then, and only then, the agent work is small and checkable:

   - Add a drain for **Function** and **Edge** sources.
   - Point it at an endpoint that accepts one. Sentry's DSN is *not* a log
     drain endpoint — this needs a provider that accepts drains (Axiom,
     Better Stack, Datadog) or Sentry's own drain support if it exposes
     one by then. **Decide deliberately rather than defaulting**, the same
     way hosting and storage were decided.
   - **Verify logs actually arrive.** Installing an integration is not the
     same as logs arriving — that exact mistake was made and caught on
     2026-08-15, when Sentry's Vercel integration was installed and had
     created no drain at all. Trigger a `console.error` through the Gmail
     callback and confirm it lands at the destination.
   - Update `scripts/verify-deployment.mjs` to move "Log drain delivering"
     from the manual list to an automated check where possible, and mark
     the criterion met in this file **with the evidence**, not with an
     assertion.

   What this buys, stated plainly so the cost is judged honestly: Sentry
   already covers anything that **throws**. A drain covers what does not —
   a function that times out, a request that hangs, a platform-level
   failure, and the logs surrounding an incident. Vercel's built-in
   runtime logs are not a substitute: short retention, no alerting.

   Worth checking at the same time, since the plan is the gate for several
   of them: Pro also lifts function duration limits and adds password
   protection for preview deployments — the latter matters once previews
   hold anything real.

2. **Act on the external review (2026-08-15).** **Decided by Omar as the
   item immediately after the Pro upgrade.** Split into **2a (done,
   2026-08-16)** and **2b (open)** — the same way session 10 became Part
   A/Part B and IDent's session 22 became 22b, because one entry covering
   eight findings cannot be either finished or honestly reported as
   partly finished.

   An external review of `main` at `5d31d658` (CI passing, dependency
   audit clean) raised 14 findings. Its verdict: *"reasonable as a
   controlled beta using test/noncritical data"*, with a named list of
   blockers before wider or commercial release. That framing is accepted —
   the point of this session is to work the list, not to argue with it.

   **Already fixed before this session, in response to the review** — its
   findings #2 and #11, both introduced by the same day's work:

   - The `RECEIPTLESS_STATE.md` contradiction (retention "unconfirmed" in
     a Still-open list, confirmed further down). The historical entries
     are kept and marked superseded rather than rewritten.
   - `react-hooks/set-state-in-effect` in `GmailConnections.tsx`, fixed by
     seeding connections from the server component instead of a mount
     effect — **and CI now runs lint**, which it never did. `npm run lint`
     had been reporting 729 errors from the generated Prisma client and
     agent worktrees, so ignoring it was rational; both are now excluded
     and the remaining output is small enough to gate on.

   **This session's work, in the review's own priority order:**

   1. **Backup and restore protection** (#1). Six-hour PITR with no
      independent daily backup and no tested restore is too thin for data
      anyone would miss. Extend retention or add periodic independent
      dumps; **perform and document a real restore**; define acceptable
      RPO and RTO explicitly rather than inheriting whatever the tier
      gives.
   2. ~~**Authentication throttling and CSRF** (#4, #5).~~ **Done
      2026-08-16 — this is session 2a.** Rate limiting is a fixed-window
      counter in Postgres (`src/lib/rate-limit/`), keyed by
      `(bucket, subject)` and incremented by a single atomic
      `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. In Postgres and
      not in memory because this runs on Vercel, where consecutive
      requests land on different instances and a per-process counter
      would limit nothing. One statement and not read-then-write because
      that race is worst exactly when a flood is happening — a test fires
      20 concurrent requests at a limit of 5 and asserts that precisely 5
      pass.

      **The design is shared with IDent, which the review asked for.**
      Same bucket names, same limits, same 429 + `Retry-After`, same
      atomic statement; IDent's copy is `apps/api/src/rate-limit/`. The
      two repos now have one answer to this, not two.

      Login is limited **per-username as well as per-IP**, which is what
      actually stops credential stuffing — per-IP alone does nothing
      against a spread-out attempt on one account. **The cost, recorded
      rather than buried:** someone can spend failures to lock a known
      username out of login for the window. It is per-window rather than
      cumulative, and unlike IDent this app has no passkey path as a
      second way in — worth knowing before that number is lowered.

      The origin policy is now **one middleware** (`src/middleware.ts`)
      over every mutating method, replacing three call sites that all
      came from session 3's claim flow. GET is deliberately not checked:
      the Gmail OAuth callback is a top-level redirect that legitimately
      arrives with a cross-site `Referer`, and checking it would break
      connecting an account every time. Server-to-server callers
      (Postmark, a POS terminal) send neither header and are unaffected;
      their control is their own credential, which is the right one for a
      non-browser caller.

      **What is honestly weaker than it looks, stated rather than
      discovered later:**

      - **Enforcement is off inside the test suite** unless a test asks
        for it (`RATE_LIMIT_ENFORCE=1`). Every test file shares one
        Postgres and no test request carries a client IP, so a
        suite-wide limit would make unrelated tests fail each other in
        exactly the shape this repo has twice misread as a regression.
        The consequence is real: the ordinary route tests prove nothing
        about throttling, and only `rate-limit.test.ts` exercises the
        enforced path.
      - **The limits cannot live in middleware**, because Next runs
        middleware on the edge runtime and Prisma cannot follow, so each
        mutating handler calls `enforceRateLimit` itself. A coverage test
        asserts every mutating API route does — it is the stand-in for
        IDent's single Fastify hook, and it was checked by removing one
        call and watching it fail.
      - **`x-forwarded-for` is trusted**, which is correct on Vercel
        (the platform sets it) and would be wrong behind a proxy that
        does not. Recorded in DEPLOYMENT.md.
      - **Counter rows are pruned opportunistically**, at most once per
        instance per hour, because Vercel has no long-lived process to
        hang a timer on. A Vercel cron would be better and does not
        exist yet — see #8 below, which is the same class of problem.

      **Session 2b — the rest of the review list. DONE 2026-08-16**,
      for every part that does not need an account, a purchase, or
      production credentials. What each item actually closed, and what it
      pointedly did not:

      - **#1 backups.** `scripts/backup-database.mjs` writes an
        independent dump with a checksum;
        `scripts/verify-backup-restore.mjs` restores it into a scratch
        database and compares per-table row counts. **Rehearsed
        2026-08-16 — seven tables, matching counts, PASS.** RPO and RTO
        are now written down as targets (DEPLOYMENT.md §6) instead of
        implied. **Not closed:** a restore of the *production* Neon
        database, extending retention past six hours, and scheduling the
        dump — a Vercel cron cannot write a durable file anywhere.
      - **#6/#7 retryable parsing.** Unreadable mail is retained on its
        delivery row and reprocessable rather than marked seen and lost;
        `GET /api/email/deliveries` shows the owner what was skipped and
        why. **Not closed:** the rows already in production —
        `scripts/repair-legacy-receipts.mjs` does it, dry-run by default,
        and needs Omar to point it at production.
      - **#8 plausibility — and a real bug it found.** **Production data
        may be affected and `repair-legacy-receipts.mjs` cannot find it**
        — a wrong-but-plausible total looks exactly like a right one.
        `scripts/audit-suspect-totals.mjs` (read-only, no `--apply`)
        re-reads each retained message and flags receipts whose stored
        total is exactly what the bug would have produced. **Needs Omar
        to run it against production.** Receipts whose message was not
        retained cannot be checked this way at all; those need the source
        mail read by hand. Adding the range
        check surfaced something worse than the check was for:
        `AMOUNT_AT_END` matched a *suffix* of a longer digit run, so
        "Total: 88123456789.00" became a confident, plausible, completely
        wrong £789.00 receipt. A wrong amount in a vault is worse than a
        missing one, because nothing about it looks wrong later. **Not
        closed:** confidence scoring and real anonymised fixtures, both
        of which need Omar's actual receipt mail.
      - **#9/#10 OCR.** Automatic photo reading is now off unless a
        deployment both configures a service and acknowledges that the
        model weights are non-commercial — and the capture screen says
        so instead of failing after the upload. **Not closed:** the
        licensing question itself, which is Omar's and does not improve
        by being deferred.
      - **#12 browser-level test.** Two Playwright journeys against a
        production build, asserting no uncaught page error and no console
        error anywhere. Checked by breaking it on purpose. CI runs it.
      - **#14 session growth.** A daily maintenance cron deletes sessions
        dead for more than a week and stale rate-limit counters. **Not
        closed:** whether to cap concurrent sessions or offer "log out
        other devices" — product decisions, still Omar's.
   3. **Existing-data repair, and retryable parsing** (#6, #7, #8). The
      parser no longer imports totals it could not read, but the `$0.00`
      and date-as-merchant rows from the first scan **are still in
      production**, and unparseable messages are marked seen with the
      Gmail cursor advanced — so a better parser will never revisit them
      (`inbound-email-ingestion.ts`). Needs a retryable/review state,
      controlled reprocessing, and real anonymised fixtures with
      confidence scoring and plausibility checks.
   4. **Production observability** (#3) — closed by session 1 above if the
      Pro upgrade happens; otherwise still open.
   5. **OCR hosting and licensing** (#9, #10). Either deploy and monitor
      the Surya service or **label it unavailable in production**, and
      resolve that its model weights are non-commercial — replace them,
      license them, or exclude the feature from commercial use. This is a
      licensing question, not an engineering one, and it does not improve
      by being deferred.
   6. **Browser-level end-to-end test** (#12). `npm run smoke` uses
      `fetch`, so it cannot see hydration failures, client exceptions,
      broken controls, or navigation problems — a limitation stated when
      it was written. Add a minimal Playwright journey.
   7. **OAuth publication** (#13). Seven-day expiry is fine for a
      controlled beta and not for general availability. `gmail.readonly`
      is a restricted scope, so publication means Google's security
      assessment — start it early or accept beta-only status deliberately.
   8. **Session table growth** (#14). Every login writes a row; no
      cleanup, no concurrent-session cap, no "log out other devices". Add
      periodic deletion of expired and revoked rows before traffic
      accumulates. This was already logged in "Known open decisions" and
      has now been raised independently, which is a reason to stop
      deferring it.

   **Sequencing note:** items 1 and 2 are the ones that gate real users.
   Everything else can follow. Do not let 3 and 8 be postponed
   indefinitely on the grounds that they are unglamorous — both get worse
   with time and traffic.

3. **Real search.** Postgres full-text over merchant, item names, and
   notes, replacing today's `ILIKE` in `/api/search`. Ranking, and a
   search UI that shows *why* a receipt matched. Semantic search is
   explicitly out of scope — revisit once full-text is real and there's a
   concrete reason to want more.
4. ~~**Warranty and return windows, surfaced.**~~ **Done 2026-08-20 —
   see "Completed components (Phase 2 session 4)" below.** `/coverage`
   carries the two lists, `/receipts/[id]` carries entry, and the columns
   the schema had held unread since Phase 0 are finally read.
5. ~~**Export: CSV and PDF.**~~ **Done 2026-08-20 — see "Completed
   components (Phase 2 session 5)" below.** Both formats are owner-scoped,
   read in 100-receipt batches, and streamed to the client.
6. ~~**Tax-category tagging.**~~ **Done 2026-08-21 — see "Completed
   components (Phase 2 session 6)" below.** A rules layer, item-level
   categories finally read, and a year's summary that exports.
7. ~~**Multi-currency with historical FX.**~~ **Steps 1–3 done
   2026-08-21 — see the top of this file for the full account.** The rate
   is captured at ingest and stored on the receipt as an immutable
   snapshot, so a revised series or a vanished provider can never change
   what a past purchase cost. Rates are canonical decimal text rather
   than floats, minor-unit scales are per-currency rather than assumed to
   be two, and the tax summary converts at each receipt's stored rate
   while still naming what it cannot convert. **Step 4, the API adapter,
   needs Omar** — and the provider question is decided by EGP, which
   eliminates the obvious free answer. Manual rate entry makes the
   feature work end to end meanwhile, and is a permanent path rather than
   a stopgap.

## Production data audit — DONE, 2026-08-18

Run against the production branch in Neon's SQL editor. Recorded here
with the numbers rather than as "checked, fine", because the point of
the exercise was that nobody had ever looked.

**Coverage was total, which is what makes the negative result mean
something.** All **25** receipts in production came from email, and all
**25** had retained their original message (`Receipt.rawPayload`), so
every one could be re-read.

**The amount-parsing bug (#8): zero matches.** No receipt's stored total
equals what the old suffix-matching regex would have produced from a long
number on its line. Full coverage plus zero hits is a real clean bill of
health, not an absence of evidence.

**Zero-total rows: four, and they were not the same thing.**

| Merchant | Amount in the message? | Outcome |
| --- | --- | --- |
| Talabat (15 Aug) | no | deleted |
| Talabat (3 Aug) | no | deleted |
| Jumia Order Confirmation | no | deleted |
| **Anthropic, PBC (5 Aug)** | **yes — $22.80** | **corrected, not deleted** |

Three were order confirmations containing no money-shaped number
anywhere. The fourth was a **real invoice**: `Pro Qty 1 $20.00`,
`VAT - Egypt (14%) $2.80`, `Total $22.80`, `Amount paid $22.80` — stored
as $0.00 because the entire receipt arrived on one unwrapped line and
every adapter anchors its amount at end-of-line. Corrected to 2280 by a
single UPDATE; the three others deleted. **Production now holds 22
receipts, none with a zero total.**

That message is also why `receipt-adapters/inline-summary.ts` exists,
and why `INLINE_INVOICE_TEXT` is the first fixture in this repo derived
from mail a real merchant actually sent (review item #8's "real
anonymised fixtures"). The shape is preserved exactly; names, numbers
and URLs are replaced.

**Two tooling bugs this exposed, both fixed:**

1. **`repair-legacy-receipts.mjs` would have deleted the Anthropic
   receipt.** Its original form deleted every zero-total row. Destroying
   a record of a real payment to tidy up a parser's mistake is strictly
   worse than the mistake. It now classifies rows and refuses to delete
   any whose message still contains an amount, whatever flags are passed.
2. **SQL written against an unmerged migration aborted in production.**
   The delete was first attempted with `status` and `failureReason` on
   `InboundEmailDelivery` — columns this branch's migration adds and
   production did not have. Postgres aborted the transaction and it was
   correctly rolled back. The script now checks `information_schema`
   first and refuses with a sentence.

**Still open from this session's own work:** the `receipts_audit`
read-only role in Neon was never made usable (three separate credential
mistakes: a base64 password containing URL-structural characters, a
clipboard that drifted between two commands, and a trailing newline from
`openssl rand > file`). It is not on the critical path — every query
above ran in the SQL editor — but **its password was exposed in a
terminal and should be rotated or the role dropped.**

**What no script can check, and nobody has:** whether the 22 remaining
totals match the source mail. The parsing-bug audit rules out one
specific failure; it does not confirm every amount is right. That needs
eyes on the vault next to Gmail, and has not been done.

## Completed components (Phase 2 session 4 — warranty and return windows)

Done 2026-08-20. ROADMAP.md names "I need to return this" as a use case
the vault exists to answer, and until this session the vault could not
answer it: `ReceiptItem.warrantyMonths` and `ReceiptItem.returnWindowDays`
were added in Phase 0 as a "lightweight seed for the warranty/return
layer" and **no code had ever read either column** — not a route, not a
page, not a report.

**What exists now**

- `src/lib/coverage.ts` — the date arithmetic and the owner-scoped query,
  in one module, the way `lib/search.ts` holds both for search.
- `src/app/coverage/page.tsx` — "Returnable" and "Still under warranty"
  as two lists, ordered by whatever runs out first.
- `src/app/receipts/[id]/page.tsx` — **the first per-receipt page this
  application has ever had.** The vault list was a row you could read and
  not open.
- `POST /api/receipts/[id]/items` and
  `PATCH /api/receipts/[id]/items/[itemId]` — add an item, set or clear
  its coverage. Both rate-limited on `receipt-write` and both scoped by
  `(receipt id, ownerId)` in the query itself, not by the URL nesting.
- The vault list shows an open return deadline per receipt, and links
  through. Warranties are deliberately **not** on that list: a three-year
  warranty on every row is noise, a return window closing on Tuesday is
  not.

**Decisions worth naming, because each one could reasonably have gone the
other way**

- **Day-granular UTC, not timestamps.** A warranty is a calendar
  statement. Two receipts from the same day — one stamped just after
  midnight, one just before — must expire together, or the answer to "can
  I still return this?" depends on what time the merchant's system fired
  the receipt. Month arithmetic clamps to the end of a shorter month: one
  month from 31 January is 28 February.
- **The last day counts as covered.** A 14-day window bought 14 days ago
  ends *today*, not yesterday.
- **No cover and expired cover are different answers.** A null warranty
  means nobody ever told us. Rendering that as "expired" would invent a
  fact about the merchant's terms.
- **Expired is hidden, never dropped.** Proving something *was* under
  warranty on a given date is a real reason to keep a receipt.
- **PATCH edits the two coverage columns and nothing else.** It cannot
  become a way to rewrite a merchant-pushed receipt's prices or totals —
  amending what a merchant attested is a different action with a
  different trust question attached, and it is not this one.

**Limitations, recorded rather than fixed**

1. **Coverage is entered by hand, always.** Nothing extracts a warranty
   or a return window from a receipt automatically — not the OCR path,
   not any of the four email adapters. Real merchant mail states these
   terms in prose ("30-day returns"), and parsing that reliably is its
   own piece of work, not a rider on this one. Until then every value on
   `/coverage` is one somebody typed.
2. **The add-item route exists because manual entry captures no items at
   all.** `ReceiptForm` sends a merchant, a total and a date — never a
   line item — and the `key-value` and `inline-summary` adapters return
   an empty item list too. So a receipt frequently has nothing to attach
   coverage *to*, and the route works around that rather than fixing it.
   The real fix is item entry in `ReceiptForm`, which belongs with
   session 6's per-item categories.
3. **Not click-through verified in a browser.** `npm run build` passes
   and both new pages are in the route table, and this repo has been
   caught before by exactly the gap between "it builds" and "it works
   when a person clicks it" (Session 4's follow-up, Session 5's). The
   Playwright journey from session 2b does not cover these pages yet.

**Verification**

`npm run typecheck` and `npm run lint` clean (lint's three warnings are
pre-existing), `npm run build` passes with `/coverage`,
`/receipts/[id]`, `/api/receipts/[id]/items` and
`/api/receipts/[id]/items/[itemId]` all in the route table, and the suite
is **322 tests across 39 files, all passing**, run with
`--maxWorkers=1 --fileParallelism=false` per this file's own decisive
test for contention-versus-regression. **20 of those are new** — 12 in
`src/lib/coverage.test.ts`, 8 in the item routes' own file — and no
existing test was modified, so the baseline this session started from was
302 across 37 files. README's "298 across 36" was already one session
stale before this one; it is now corrected.

## Completed components (Phase 2 session 5 — CSV and PDF export)

Done 2026-08-20. The vault now exposes two authenticated downloads:
`GET /api/export/csv` for analysis and `GET /api/export/pdf` for a human-
readable archive. Both query by `ownerId` at the database boundary, read
100 receipts at a time, and stream their output instead of retaining the
whole vault in application memory.

**CSV contract**

- One row per receipt item, with receipt fields repeated so the file is
  usable without joins. A receipt with no items still produces one row.
- Monetary values remain integer minor units; this preserves exact stored
  data and avoids locale-dependent parsing.
- UTF-8 BOM and CRLF make the download spreadsheet-friendly. Quotes,
  commas, and newlines are escaped, and cells beginning with spreadsheet
  formula sigils are prefixed to prevent formula injection.

**PDF contract**

- One receipt section per page with merchant, purchase date, totals,
  provenance, items, coverage terms, notes, and the immutable receipt ID.
- PDFKit was the approved rendering choice. The server route imports its
  standalone distribution: live-app testing caught that the default entry
  makes Turbopack resolve built-in Helvetica metrics below `/ROOT`, yielding
  a production-shaped 500 even though isolated route tests pass.
- An empty vault still yields a valid explanatory PDF.

The vault page links directly to both downloads. Focused route tests cover
authentication, owner isolation, CSV edge cases, PDF headers and bytes,
and the empty-vault case. A live authenticated export was rendered to an
image and inspected for clipping, overlap, and readability. **At Session 5
completion on 2026-08-20**, the complete suite passed **338/338**,
typecheck passed, lint passed with six pre-existing warnings and no errors,
and the optimized Turbopack build passed with both export routes present.
`npm audit` still reports the known
high-severity `deepmerge-ts` advisory through Prisma's CLI/config chain;
the offered fix is a Prisma major downgrade, so it was recorded rather than
silently forced into this feature session.

### Session 5 hardening — done 2026-08-21, after review

The export shipped working and unreviewed. Reviewing it before opening the
PR turned up five things, recorded here because four of them were invisible
to a green suite:

1. **Neither export was rate limited.** `enforceRateLimit` covered every
   mutating route and the structural test in `csrf-policy.test.ts` asserted
   exactly that — but both exports are `GET`, so the guard never looked at
   them, and a full-vault walk shipped uncapped next to a 30/hour cap on
   OCR. Both now take the new `receipt-export` policy (12/hour, session-
   scoped, one bucket shared by the two formats because the cost being
   limited is the vault walk, not the file format). The coverage test now
   also requires every read-only route to be limited *or* named in an
   explicit exemption list with a reason, so the next unlimited GET fails
   the suite instead of shipping.

2. **Every receipt was rendering a blank second page.** Found by the first
   test to assert a page count rather than "the bytes look like a PDF": 3
   receipts produced 6 pages. The `Receipt ID` footer is drawn below the
   bottom margin, and PDFKit treats anything past `page.maxY()` as overflow
   — so it opened a fresh page and printed the footer alone on it. The
   archive was twice as long as it should be, and the manual image
   inspection recorded above did not catch it because the *first* page of
   every receipt looks right. Fixed with PDFKit's own footer idiom (drop
   the bottom margin for the one call, restore it immediately).

3. **Neither stream applied backpressure.** Both did all their work inside
   `start()`, which runs to completion whether or not anything is reading,
   so a slow client turned a streamed export back into a buffered one held
   in the stream's queue. CSV is now `pull`-driven over an async generator;
   the PDF gates PDFKit on `desiredSize` and makes the render loop wait
   with it, since pausing the output alone would only move the archive into
   PDFKit's own buffer. Both use a 64 KB byte-counting queue.

4. **Neither stream handled cancellation.** An aborted download kept
   querying the database and enqueuing into a cancelled controller; the
   throw was caught and passed to `controller.error()` on an already-closed
   controller, which threw again inside an async `start()` with nothing to
   catch it. Both streams now implement `cancel()`.

5. **Nothing tested the batch seam.** `cursor` plus `skip: 1` at
   `EXPORT_BATCH_SIZE` is right or off by exactly one row, and a vault
   smaller than one batch never says which. `src/lib/receipt-export.test.ts`
   now straddles the boundary with 101 receipts for both formats.

Both routes also declare `runtime = "nodejs"` explicitly rather than
relying on inference — the PDFKit `/ROOT` note above is the same class of
failure, and it is not worth discovering twice.

## Completed components (Phase 2 session 6 — tax-category tagging)

Done 2026-08-21. `Receipt.category` existed and was set by hand;
`ReceiptItem.category` had been in the schema since Phase 0 and **nothing
had ever written to it** — the same shape of gap as Session 4's warranty
columns. Both are now filled by a rules layer, and a year of them totals
into something exportable.

**The rules layer** (`src/lib/categories.ts`, pure and database-free so it
can be tested without one)

- A rule is a case- and punctuation-insensitive **substring**, not a
  regular expression. A user-authored regex is two problems: a
  denial-of-service vector evaluated server-side over every item of every
  receipt, and something nobody can debug — "why did this rule fire?"
  should be answerable by reading the rule. Normalisation means
  `starbucks` catches `STARBUCKS #1174`.
- Owner rules beat built-in defaults, always. The defaults are guesses
  about how the world is named and will be wrong for someone; being able
  to override them is what makes the layer usable instead of something to
  work around.
- `resolveCategory` returns **null** when nothing matches rather than
  `OTHER`, so "no rule had an opinion" stays distinguishable from "a rule
  decided OTHER". The whole never-overwrite-a-choice rule depends on that
  distinction.
- `explainCategory` names the rule that fired and whether it was the
  owner's or a default — same reasoning as Session 3's search showing
  *why* a receipt matched. A classification nobody can interrogate is one
  nobody can correct.

**Where it applies**

- `POST /api/receipts`, the owner-facing path.
- **Inbound email**, which is the one that mattered. No UI means nobody
  picks a category, so every emailed receipt previously landed on the
  schema default and stayed there — the tax summary's largest blind spot
  was its most automatic source of data. Classification runs inside the
  existing ingestion transaction, reading rules through the same client so
  it cannot see a half-committed rule.
- **Claim**, for merchant-issued receipts. Those have no owner when they
  are created, so there are no rules to apply until the claim — that is
  the first moment "whose categories?" has an answer. Deliberately *after*
  the guarded update that makes claiming atomic: classification is a
  convenience, and folding it into the guard would trade a real ownership
  guarantee for a cosmetic one.
- A category that was **chosen** is never overwritten. `OTHER` is read as
  "no opinion" because it is indistinguishable in the payload from a
  client that simply did not say — and refusing to classify until someone
  picks something first would make the layer useless for exactly the
  pathways that have no UI.

**The summary** (`/tax`, `GET /api/reports/tax`, `GET /api/export/tax/csv`)

- Two columns per category, because they answer different questions:
  receipt totals (what a return asks for, one category per receipt) and
  item totals (which cut across receipts — paracetamol bought during a
  grocery shop is health spending on a groceries receipt). They do not add
  up to each other and are not meant to.
- **It does not say what is deductible, and it should not.** That depends
  on jurisdiction, employment status and the purpose of each purchase —
  facts this app does not have. A category quietly labelled "deductible"
  would be tax advice by implication, and being wrong about it costs the
  user money they would not discover until it mattered. Stated on the page
  itself, not buried here.
- Mixed currencies are **named, never summed**. Historical FX is Session 7;
  converting at today's rate would produce a confident wrong number in
  someone's return. The warning travels in the CSV as well as on the page,
  because the file outlives the page it came from.
- The CSV is not streamed, unlike the receipt exports: it is at most ten
  rows plus a total, and the aggregation has to finish before the first
  row is known anyway.

**Rate limiting.** The tax CSV shares `receipt-export`'s bucket — the cost
being limited is a vault walk, and this walks a year of one. The two new
read-only routes are recorded in the exemption list Session 5's hardening
added, with reasons, rather than left unlimited by omission.

Verified: **384 tests across 49 files** (up from 346/44), typecheck clean,
optimized build passing with all four new routes present. One earlier run
of the suite reported four failures that did not reproduce across two
subsequent clean runs — consistent with the parallel-load flakes recorded
in `known-test-flakes`, and noted here rather than quietly re-run until
green.

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

- **Spending guardrails: where AI inference runs, and whether cohort
  benchmarking happens at all.** ROADMAP.md's "Spending guardrails"
  section (Phase 6, documented intent) needs two decisions *before* any
  of it is built, not after. First, sending itemized purchase history to
  a third-party model is a different privacy posture than anything in the
  vault today and is in direct tension with the client-side E2E item
  above — if the server can't read receipts it can't analyse them, so
  on-device/self-hosted inference vs. a no-training processing agreement
  is a fork that changes the architecture, not a vendor pick. Second, the
  occupation-cohort benchmarking in that section requires k = 50 users per
  cohort cell plus DP noise before a single comparison can be shown, and
  carries a permanent prohibition on selling or exposing cohort
  statistics to merchants, employers, insurers, or lenders — which
  forecloses a monetization path Phase 3's merchant offering might
  otherwise reach for. Both are Omar's calls.

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

**Session 10 Part B — the production-like vertical slice. Blocked on
Omar.** Part A is done (see the evidence ledger above); Part B cannot
start without accounts only Omar can create:

1. **A real Google OAuth client.** The highest-leverage credential in
   either repo — one client unblocks this repo's Gmail scanner *and*
   IDent's Gmail/Calendar sync. Until it exists the second ingestion path
   is theory with tests around it.
2. **A hosting target**: Vercel project plus hosted Postgres, per
   `DEPLOYMENT.md`.
3. **An inbound-email provider decision** (SendGrid Inbound Parse,
   Postmark, Mailgun, Cloudflare Email Routing) plus a domain. Session 6
   built the webhook against a documented payload contract precisely so
   this choice stays swappable — but it still has to be made.

The exit criteria are listed under "Session 10" above and are **all of
them, not a subset**: real identity and OAuth, secret management,
observability, a *rehearsed* rollback, readiness checks against the real
database, and migrations run as a release step.

**This section was stale until 2026-08-14.** It still read "Session 6 —
Email ingestion, path A" long after sessions 6 through 9 had shipped, so
a cold read of this file got a next-action three sessions behind the
header at the top. That is precisely the resumability bug the top of this
file says is a bug. Whoever finishes a session updates *both* ends.
