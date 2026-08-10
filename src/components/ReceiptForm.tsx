"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  "GROCERIES",
  "DINING",
  "TRANSPORT",
  "UTILITIES",
  "HEALTH",
  "SHOPPING",
  "ENTERTAINMENT",
  "TRAVEL",
  "EDUCATION",
  "OTHER",
] as const;

export type ReceiptFormValues = {
  merchant: string;
  amount: string;
  currency: string;
  category: (typeof CATEGORIES)[number];
  purchasedAt: string;
  source: string;
  imageUrl?: string;
  rawPayload?: string;
};

const emptyValues = (
  overrides: Partial<ReceiptFormValues> = {}
): ReceiptFormValues => ({
  merchant: "",
  amount: "",
  currency: "USD",
  category: "OTHER",
  purchasedAt: new Date().toISOString().slice(0, 10),
  source: "MANUAL",
  ...overrides,
});

export default function ReceiptForm({
  initialValues,
}: {
  initialValues?: Partial<ReceiptFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ReceiptFormValues>(
    emptyValues(initialValues)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof ReceiptFormValues>(
    key: K,
    value: ReceiptFormValues[K]
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const amount = Number(values.amount);
    if (!values.merchant || Number.isNaN(amount)) {
      setError("Merchant and a valid amount are required.");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant: values.merchant,
        amount,
        currency: values.currency,
        category: values.category,
        purchasedAt: new Date(values.purchasedAt).toISOString(),
        source: values.source,
        imageUrl: values.imageUrl,
        rawPayload: values.rawPayload,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Could not save receipt. Try again.");
      return;
    }
    router.push("/receipts");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full max-w-sm">
      <label className="flex flex-col gap-1 text-sm">
        Merchant
        <input
          className="border rounded px-3 py-2 bg-transparent"
          value={values.merchant}
          onChange={(e) => update("merchant", e.target.value)}
          placeholder="e.g. Whole Foods"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-col gap-1 text-sm flex-1">
          Amount
          <input
            className="border rounded px-3 py-2 bg-transparent"
            value={values.amount}
            onChange={(e) => update("amount", e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm w-24">
          Currency
          <input
            className="border rounded px-3 py-2 bg-transparent"
            value={values.currency}
            onChange={(e) => update("currency", e.target.value.toUpperCase())}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Category
        <select
          className="border rounded px-3 py-2 bg-transparent"
          value={values.category}
          onChange={(e) =>
            update("category", e.target.value as ReceiptFormValues["category"])
          }
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0] + c.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Date
        <input
          type="date"
          className="border rounded px-3 py-2 bg-transparent"
          value={values.purchasedAt}
          onChange={(e) => update("purchasedAt", e.target.value)}
        />
      </label>

      {values.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={values.imageUrl}
          alt="Receipt preview"
          className="rounded border max-h-48 object-contain"
        />
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save receipt"}
      </button>
    </form>
  );
}
