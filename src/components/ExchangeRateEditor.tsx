"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Phase 2 session 7, step 2 — entering the rate by hand.
 *
 * The rate is a **string** the whole way to the server. Binding it to a
 * number input and letting JSON turn it into a double would silently
 * change some of the rates people type, which is the exact failure the
 * canonical-decimal handling exists to prevent — so this is a text input
 * and the value is never parsed on the client.
 */
export function ExchangeRateEditor({
  receiptId,
  sourceCurrency,
  targetCurrency,
  purchasedOn,
  currentRate,
}: {
  receiptId: string;
  sourceCurrency: string;
  targetCurrency: string;
  purchasedOn: string;
  /** Present when a rate is already stored, so this becomes a correction. */
  currentRate?: string;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(currentRate ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const response = await fetch(`/api/receipts/${receiptId}/fx-rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rate, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    });

    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "That rate could not be saved.");
      return;
    }
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {targetCurrency} per 1 {sourceCurrency}, on {purchasedOn}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          placeholder="0.0207"
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 font-mono"
          required
        />
      </label>

      {currentRate && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            Why it is changing — kept with the correction
          </span>
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="matched the figure on the card statement"
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1"
          />
        </label>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded bg-emerald-600 text-white px-3 py-1 text-sm disabled:opacity-60"
      >
        {saving ? "Saving…" : currentRate ? "Correct the rate" : "Save the rate"}
      </button>

      <p className="text-xs text-neutral-500">
        Enter it exactly — no trailing zeros. The rate is stored against this
        receipt permanently, so a later correction records a new version rather
        than moving this figure.
      </p>
    </form>
  );
}
