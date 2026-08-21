"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORIES, type CategoryName, type RuleTarget } from "@/lib/categories";

type Rule = {
  id: string;
  pattern: string;
  category: CategoryName;
  target: RuleTarget;
  priority: number;
};

/**
 * Session 6. Where a person overrides the built-in defaults.
 *
 * The defaults are guesses about how the world is named — "cafe" means
 * dining, "market" means groceries — and they will be wrong for someone.
 * Being able to correct them is what makes the rules layer usable rather
 * than something to work around, which is why owner rules always win.
 */
export function CategoryRules({ initialRules }: { initialRules: Rule[] }) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState<CategoryName>("GROCERIES");
  const [target, setTarget] = useState<RuleTarget>("MERCHANT");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addRule(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/category-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pattern, category, target }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Could not save that rule.");
        return;
      }
      const saved: Rule = await response.json();
      // Replaces rather than appends when the pattern already existed —
      // the API upserts, so appending would show two rules where the
      // database holds one.
      setRules((current) => [...current.filter((rule) => rule.id !== saved.id), saved]);
      setPattern("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/category-rules/${id}`, { method: "DELETE" });
      if (response.ok) {
        setRules((current) => current.filter((rule) => rule.id !== id));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Your category rules</h2>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        A rule files anything whose name contains the text you give it. Yours always
        beat the built-in guesses, and they only apply to receipts you have not
        categorised yourself. Matching ignores case and punctuation, so{" "}
        <code>starbucks</code> catches <code>STARBUCKS #1174</code>.
      </p>

      <form onSubmit={addRule} className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs">
          <span>Text to match</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            placeholder="starbucks"
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>In</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as RuleTarget)}
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
          >
            <option value="MERCHANT">the merchant name</option>
            <option value="ITEM">an item name</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>File as</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryName)}
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm"
          >
            {CATEGORIES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Add rule
        </button>
      </form>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {rules.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No rules yet — the built-in guesses are doing the filing.
        </p>
      ) : (
        <ul className="text-sm divide-y divide-neutral-100 dark:divide-neutral-900">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <code>{rule.pattern}</code> in{" "}
                {rule.target === "MERCHANT" ? "the merchant name" : "an item name"} →{" "}
                <strong>{rule.category}</strong>
              </span>
              <button
                onClick={() => removeRule(rule.id)}
                disabled={busy}
                className="text-xs underline text-neutral-500 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
