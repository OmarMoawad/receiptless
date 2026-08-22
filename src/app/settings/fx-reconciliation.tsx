"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Phase 2 session 8. Reconciling historical receipts into the current
 * reporting currency, from Settings.
 *
 * Two deliberate properties the copy and the flow both hold to:
 *
 * - The preview is an **estimate, not a guarantee**. It counts how many
 *   receipts are eligible, but whether a rate is actually available for
 *   each one cannot be known without doing the work, so some may remain
 *   unavailable and the wording says so up front.
 * - Apply is the explicit authorisation. It runs in batches of at most ten,
 *   under one correlation id generated per run, and continues until the
 *   server stops handing back a cursor. A browser refresh is not a
 *   rollback: rerunning is idempotent against the current approved state,
 *   and a receipt with no rate is left untouched for a manual rate + rerun.
 */

export type FxReconciliationPreviewProps = {
  reportingCurrency: string;
  total: number;
  eligible: number;
};

type ApplyResults = {
  converted: number;
  reprocessed: number;
  alreadyCurrent: number;
  sameCurrency: number;
  unavailable: number;
  failed: number;
};

type Cursor = { purchasedAt: string; id: string };

type Status = "ready" | "applying" | "complete" | "error";

const zeroResults = (): ApplyResults => ({
  converted: 0,
  reprocessed: 0,
  alreadyCurrent: 0,
  sameCurrency: 0,
  unavailable: 0,
  failed: 0,
});

/**
 * The preview is computed server-side and passed in, so the control opens
 * on the truth rather than fetching on mount — the same discipline the
 * reporting-currency form uses. Apply still walks the API in batches.
 */
export function FxReconciliation({ preview }: { preview: FxReconciliationPreviewProps }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("ready");
  const [processed, setProcessed] = useState(0);
  const [results, setResults] = useState<ApplyResults>(zeroResults());
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setStatus("applying");
    setError(null);
    setProcessed(0);
    const totals = zeroResults();
    setResults(totals);

    // One correlation id ties every batch of this run together, in the
    // audit trail and the logs.
    const correlationId = `fx-reconciliation:${crypto.randomUUID()}`;
    let cursor: Cursor | undefined;

    try {
      // Keep asking for batches until the server stops handing back a
      // cursor. A guard on iterations is unnecessary: each batch advances
      // the cursor past at least the rows it saw, so the walk terminates.
      for (;;) {
        const response = await fetch("/api/fx/reconciliation/apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cursor,
            limit: 10,
            expectedReportingCurrency: preview.reportingCurrency,
            correlationId,
          }),
        });

        if (response.status === 409) {
          throw new Error(
            "Your reporting currency changed while this was running. Reload the preview and try again.",
          );
        }
        if (response.status === 401) throw new Error("Your session expired. Sign in and try again.");
        if (!response.ok) throw new Error("A batch could not be applied.");

        const batch = (await response.json()) as {
          processed: number;
          nextCursor: Cursor | null;
          results: ApplyResults;
        };

        for (const key of Object.keys(totals) as (keyof ApplyResults)[]) {
          totals[key] += batch.results[key];
        }
        setResults({ ...totals });
        setProcessed((p) => p + batch.processed);

        if (!batch.nextCursor) break;
        cursor = batch.nextCursor;
      }

      setStatus("complete");
      // The tax summary and reports read the stored conversions server-side.
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Could not apply reconciliation.");
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">Reconcile past receipts</h2>

      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {preview.eligible === 0
          ? `Every receipt is already reportable in ${preview.reportingCurrency}.`
          : `${preview.eligible} of ${preview.total} receipt(s) are not yet reported in ${preview.reportingCurrency}.`}
      </p>
      <p className="text-xs text-neutral-500 max-w-prose">
        This is an estimate, not a guarantee: a receipt with no exchange rate on file
        for its purchase date stays unavailable until you enter one, and can then be
        reconciled on a rerun.
      </p>

      {preview.eligible > 0 && (
        <button
          type="button"
          onClick={apply}
          disabled={status === "applying"}
          className="rounded bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-40"
        >
          {status === "applying" ? "Applying…" : "Apply reconciliation"}
        </button>
      )}

      {(status === "applying" || status === "complete") && (
        <dl className="text-sm grid grid-cols-2 gap-x-6 gap-y-1 max-w-sm">
          <Stat label="Processed" value={processed} />
          <Stat label="Converted" value={results.converted} />
          <Stat label="Reprocessed" value={results.reprocessed} />
          <Stat label="Already current" value={results.alreadyCurrent} />
          <Stat label="Same currency" value={results.sameCurrency} />
          <Stat label="Unavailable" value={results.unavailable} />
          <Stat label="Failed" value={results.failed} />
        </dl>
      )}

      {status === "complete" && (
        <p className="text-sm text-emerald-600">
          Done. {results.unavailable > 0
            ? `${results.unavailable} receipt(s) still need a rate — enter one and rerun to include them.`
            : "Every eligible receipt was reconciled."}
        </p>
      )}

      {status === "error" && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
