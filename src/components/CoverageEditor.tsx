"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_RETURN_WINDOW_DAYS, MAX_WARRANTY_MONTHS } from "@/lib/validation";

export type EditableItem = {
  id: string;
  name: string;
  warrantyMonths: number | null;
  returnWindowDays: number | null;
};

/**
 * Per-receipt entry for Phase 2 session 4 (RECEIPTLESS_STATE.md).
 *
 * An empty box means "clear this", which is why the submit sends `null`
 * rather than omitting the field — omitting it is how the API says "leave
 * it as it was", and a person who deletes the number in a box means the
 * first thing, not the second.
 */
export function parseCoverageInput(raw: string, maximum: number): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 && value <= maximum ? value : undefined;
}

function CoverageFields({
  warranty,
  returnDays,
  onWarranty,
  onReturnDays,
  disabled,
}: {
  warranty: string;
  returnDays: string;
  onWarranty: (value: string) => void;
  onReturnDays: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Warranty (months)
        <input
          type="number"
          min={1}
          max={MAX_WARRANTY_MONTHS}
          inputMode="numeric"
          value={warranty}
          onChange={(e) => onWarranty(e.target.value)}
          disabled={disabled}
          className="border rounded px-2 py-1 text-sm bg-transparent w-32 text-neutral-900 dark:text-neutral-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Return window (days)
        <input
          type="number"
          min={1}
          max={MAX_RETURN_WINDOW_DAYS}
          inputMode="numeric"
          value={returnDays}
          onChange={(e) => onReturnDays(e.target.value)}
          disabled={disabled}
          className="border rounded px-2 py-1 text-sm bg-transparent w-36 text-neutral-900 dark:text-neutral-100"
        />
      </label>
    </div>
  );
}

function ItemRow({ receiptId, item }: { receiptId: string; item: EditableItem }) {
  const router = useRouter();
  const [warranty, setWarranty] = useState(item.warrantyMonths?.toString() ?? "");
  const [returnDays, setReturnDays] = useState(item.returnWindowDays?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    const warrantyMonths = parseCoverageInput(warranty, MAX_WARRANTY_MONTHS);
    const returnWindowDays = parseCoverageInput(returnDays, MAX_RETURN_WINDOW_DAYS);
    if (warrantyMonths === undefined || returnWindowDays === undefined) {
      setError("Use whole numbers of months and days, or leave a box empty.");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/receipts/${receiptId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warrantyMonths, returnWindowDays }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.status === 429 ? "Too many changes at once — try again shortly." : "Could not save.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <li className="border rounded px-4 py-3 flex flex-col gap-2">
      <p className="font-medium">{item.name}</p>
      <CoverageFields
        warranty={warranty}
        returnDays={returnDays}
        onWarranty={(v) => {
          setWarranty(v);
          setSaved(false);
        }}
        onReturnDays={(v) => {
          setReturnDays(v);
          setSaved(false);
        }}
        disabled={saving}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-emerald-700 dark:text-emerald-500">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </li>
  );
}

function AddItem({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [warranty, setWarranty] = useState("");
  const [returnDays, setReturnDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) {
      setError("Give the item a name.");
      return;
    }
    const warrantyMonths = parseCoverageInput(warranty, MAX_WARRANTY_MONTHS);
    const returnWindowDays = parseCoverageInput(returnDays, MAX_RETURN_WINDOW_DAYS);
    if (warrantyMonths === undefined || returnWindowDays === undefined) {
      setError("Use whole numbers of months and days, or leave a box empty.");
      return;
    }

    setSaving(true);
    setError(null);
    const res = await fetch(`/api/receipts/${receiptId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), warrantyMonths, returnWindowDays }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.status === 429 ? "Too many changes at once — try again shortly." : "Could not add the item.");
      return;
    }
    setName("");
    setWarranty("");
    setReturnDays("");
    router.refresh();
  }

  return (
    <div className="border border-dashed rounded px-4 py-3 flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Item
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What did you buy?"
          disabled={saving}
          className="border rounded px-2 py-1 text-sm bg-transparent text-neutral-900 dark:text-neutral-100"
        />
      </label>
      <CoverageFields
        warranty={warranty}
        returnDays={returnDays}
        onWarranty={setWarranty}
        onReturnDays={setReturnDays}
        disabled={saving}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={saving}
          className="rounded bg-emerald-600 text-white px-3 py-1 text-sm disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add item"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}

export function CoverageEditor({
  receiptId,
  items,
}: {
  receiptId: string;
  items: EditableItem[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Warranty and returns</h2>
      {items.length === 0 && (
        <p className="text-sm text-neutral-500">
          This receipt has no line items yet — add what you bought to track a
          warranty or a return window against it.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ItemRow key={item.id} receiptId={receiptId} item={item} />
        ))}
      </ul>
      <AddItem receiptId={receiptId} />
    </section>
  );
}
