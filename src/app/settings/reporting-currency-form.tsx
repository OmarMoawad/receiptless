"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Session 7. Changing the reporting currency.
 *
 * A plain select of the currencies the converter actually supports —
 * `knownCurrencies()` on the server hands the same list the conversion
 * path gates on, so the UI can never offer a target the API would reject.
 */
export function ReportingCurrencyForm({
  current,
  currencies,
}: {
  current: string;
  currencies: string[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== current;

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/settings/reporting-currency", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportingCurrency: value }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not save.");
      }
      setStatus("saved");
      // The tax summary is a server component that reads this value, so a
      // refresh is what makes the change visible there.
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Could not save.");
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-neutral-500" htmlFor="reporting-currency">
        Reporting currency
      </label>
      <div className="flex gap-2">
        <select
          id="reporting-currency"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setStatus("idle");
          }}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="rounded bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-40"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      {status === "saved" && !dirty && (
        <p className="text-sm text-emerald-600">Saved. Your reports are now in {current}.</p>
      )}
      {status === "error" && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
