# Phase 2 Session 8 FX Reconciliation Design

## Goal and Scope

Session 8 closes Vault Maturity with an authenticated, owner-initiated reconciliation flow for historical receipts that are not reportable in the owner's current reporting currency. It also fixes the cold-cache weekend/holiday lookup defect, conversion-creation races, stale-target tax reporting, and unsafe Apify token placement found during the Session 7 review.

The session is not a production CLI, a silent background rewrite, or a general job platform. The owner previews the work and explicitly applies bounded batches from Settings. Existing conversion history is retained.

## FX Lookup Policy

The resolver remains the authority for the fixed seven-day lookback. The provider contract changes from “fetch one date” to an inclusive lookup window `{ from, on }`.

Resolution order is unchanged:

1. active owner-entered manual rate in `[on - 7 days, on]`;
2. newest active cached provider rate in that window;
3. one provider request for the same inclusive window.

The provider result must match the requested currency direction and have an effective date between `from` and `on`. Out-of-range or future rows are rejected and never persisted. The CBE adapter sends the full date range in one Apify request and selects the newest valid matching row regardless of actor row order. This makes a first Sunday/holiday request discover Friday's rate without an eight-request retry loop.

The Apify token moves from the request URL into `Authorization: Bearer`. Logs and safe errors never contain outbound URLs, tokens, actor bodies, or raw responses.

## Reconciliation Semantics

“Needs reconciliation” is defined relative to the owner's reporting currency at preview/apply time:

- same-currency receipt: directly reportable, no conversion row required;
- approved conversion whose source matches the receipt and target matches current reporting currency: already current;
- no approved conversion: eligible for initial capture;
- approved conversion targeting an older reporting currency: eligible for explicit versioned reprocessing;
- no valid rate in the seven-day window: unavailable, not failed;
- invalid receipt/currency/provider/database error: failed with a safe category.

Apply is the explicit owner authorization that permits old-target conversions to be reprocessed. Reprocessing creates a new immutable version, links it to the prior version, and changes approval only after the new snapshot is complete. The prior snapshot remains available for audit. This is not a silent restatement caused merely by changing the reporting-currency setting.

Tax summaries select only an approved snapshot whose source currency matches the receipt and whose target matches the current reporting currency. A wrong-target snapshot is treated as unconverted and named; it is never summed and relabelled as though it used the current currency.

## Service, API, and UI

`src/lib/fx/backfill-service.ts` exposes two owner-scoped operations:

- `previewFxReconciliation(ownerId)`: performs database reads only, calls no provider, writes no rates/conversions, and returns counts grouped by source currency and category (`sameCurrency`, `alreadyCurrent`, `missing`, `oldTarget`). It labels `missing + oldTarget` as eligible attempts, not promised conversions, because availability cannot be known without provider work.
- `applyFxReconciliation(ownerId, context, cursor, limit)`: validates `limit <= 10`, selects deterministically by `(purchasedAt, id)`, processes sequentially, and returns the continuation cursor plus cumulative-safe category results.

Two authenticated POST endpoints are used:

- `POST /api/fx/reconciliation/preview`;
- `POST /api/fx/reconciliation/apply` with cursor, limit, the exact `expectedReportingCurrency` returned by preview, and correlation ID.

POST prevents intermediary caching and receives the existing same-origin middleware protection. Both endpoints apply a dedicated session-bound `fx-reconciliation` limit; apply is stricter because one batch can invoke external retrieval. Apply rechecks the current reporting currency and rejects a stale preview rather than reconciling to a currency the owner no longer selected.

Settings shows an estimate, explicitly notes that unavailable rates may remain, and requires Apply. It drives batches of at most ten and displays processed/total with `converted`, `reprocessed`, `already current`, `same currency`, `unavailable`, and `failed` counts. The user can enter a manual rate and rerun. Browser refresh does not imply rollback; rerunning is idempotent against current approved state.

No backfill-run schema is added. Existing conversion provenance is sufficient for this bounded client-driven flow. Durable asynchronous jobs, admin cross-owner runs, and resume-after-browser-close can introduce run/result tables only when they become requirements.

## Provenance and Concurrency

Initial capture and reprocessing record:

- `operator`: authenticated user ID;
- `reason`: `owner-requested FX reconciliation`;
- `correlationId`: `fx-reconciliation:<uuid>` reused across continuation batches;
- rate source, effective date, policy versions, arithmetic inputs, and lineage already carried by conversion snapshots.

All selection queries include `ownerId`; request-supplied receipt IDs are not accepted. A forged cursor cannot cross tenants because it is only a position inside an owner-filtered ordering.

`captureConversion` handles the partial-unique race shared by ingestion, receipt detail rendering, and reconciliation. If insertion loses with Prisma `P2002`, it rereads the approved winner and returns it. Reprocessing uses a transaction/guard that prevents concurrent processes from approving two versions; the loser rereads the newly approved current-target snapshot.

Provider-rate persistence retains its current unique-race recovery. Errors are isolated per receipt, logged with correlation ID and non-sensitive identifiers, and do not abort the remainder of the batch.

## Testing and Acceptance

Tests are written before behavior and cover:

- cold-cache Sunday/holiday lookup selecting and persisting Friday from one range request;
- newest valid matching row independent of response order;
- rejection of dates before the seven-day floor or after purchase date;
- cache reuse with no follow-up provider call;
- Authorization header use and absence of tokens from URLs/logs;
- concurrent initial capture and reprocessing producing one approved winner;
- preview making no writes/provider calls and remaining owner-scoped;
- apply tenant isolation, deterministic cursoring, ten-row cap, stale-preview rejection, and provenance;
- category accounting for initial capture, old-target reprocessing, races/already-current, same currency, unavailable, and failures;
- tax summary refusal to use an approved snapshot in the wrong target currency;
- unauthenticated requests, rate limits, validation, and shared CSRF/origin protection;
- Settings preview/apply/progress/error behavior.

Completion requires the focused and full test suites, typecheck, lint, build, migration-safety check, Settings browser verification, production migration/health verification where applicable, and docs/state/roadmap/badge updates. Stale statements that the CBE adapter still needs implementation are corrected. Phase 2 closes only after these checks; Session 1's deliberately deferred Vercel Pro/log-drain purchase remains separately documented and does not get falsely marked complete.

## Explicit Non-goals

- A cross-tenant admin backfill or production database CLI.
- A durable queue/job system.
- Rewriting or deleting conversion history.
- Fetching rates during preview.
- Summing or relabelling conversions in a stale target currency.
