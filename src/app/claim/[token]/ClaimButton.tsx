"use client";

import { useActionState } from "react";
import Link from "next/link";
import { formatMinorUnits } from "@/lib/money";
import { claimReceipt, type ClaimActionState } from "./actions";

const initialState: ClaimActionState = { status: "idle" };

const ERROR_MESSAGES: Partial<Record<ClaimActionState["status"], string>> = {
  already_claimed: "This claim link has already been used and can't be reused.",
  expired: "This claim link expired.",
  not_found: "This receipt link is invalid or was already removed.",
  unauthenticated: "Sign in, then try again.",
  rejected: "That request couldn't be verified — try opening the link again.",
};

export default function ClaimButton({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(claimReceipt.bind(null, token), initialState);

  if (state.status === "claimed") {
    return (
      <main className="flex flex-col items-center gap-4 p-6 max-w-sm mx-auto text-center">
        <div className="rounded-full bg-emerald-100 text-emerald-700 w-12 h-12 flex items-center justify-center text-2xl">
          ✓
        </div>
        <h1 className="text-xl font-semibold">Receipt claimed</h1>
        <div className="border rounded p-4 w-full text-left">
          <p className="font-medium">{state.merchantName}</p>
          <p className="text-sm text-neutral-500">{state.purchasedAt.slice(0, 10)}</p>
          <p className="font-mono text-lg mt-2">
            {formatMinorUnits(state.totalMinor, state.currency)}
          </p>
          {state.items.length > 0 && (
            <ul className="mt-3 text-sm text-neutral-600 flex flex-col gap-1">
              {state.items.map((item) => (
                <li key={item.id} className="flex justify-between">
                  <span>
                    {item.quantity}× {item.name}
                  </span>
                  <span>{formatMinorUnits(item.totalPriceMinor, state.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link href="/receipts" className="text-sm text-emerald-600 underline">
          View in your vault →
        </Link>
      </main>
    );
  }

  const errorMessage = ERROR_MESSAGES[state.status];

  return (
    <form action={formAction} className="flex flex-col items-center gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {isPending ? "Claiming…" : "Claim this receipt"}
      </button>
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
    </form>
  );
}
