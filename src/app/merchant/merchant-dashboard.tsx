"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MerchantAccountSummary, MerchantLocationSummary } from "@/lib/merchant/service";
import { dashboardControlsFor } from "./dashboard-view";

/**
 * Phase 3 Session 1. The merchant workspace: the accounts a person
 * administers, a form to register a new merchant, and — per selected
 * account — its locations with a role-gated form to add one. The role-aware
 * hiding here is a convenience only; the API re-authorizes every call.
 */
export function MerchantDashboard({
  accounts,
  locationsByAccount,
}: {
  accounts: MerchantAccountSummary[];
  locationsByAccount: Record<string, MerchantLocationSummary[]>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, website: website.trim() || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not create the merchant account.");
      }
      setName("");
      setWebsite("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-8">
      <h1 className="text-lg font-semibold">Merchant workspace</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
          Register a new merchant
        </h2>
        <form onSubmit={createAccount} className="space-y-2">
          <input
            aria-label="Merchant name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Merchant name"
            required
            maxLength={200}
            className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
          <input
            aria-label="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com (optional)"
            className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="rounded bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50"
          >
            Create merchant account
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
        <p className="text-xs text-neutral-500 max-w-prose">
          This registers a brand-new merchant you own. It does not claim an existing
          merchant that receipts already reference — verified ownership of an
          established name comes later.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
          Your merchant accounts
        </h2>
        {accounts.length === 0 && (
          <p className="text-sm text-neutral-500">You don&apos;t administer any merchants yet.</p>
        )}
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            locations={locationsByAccount[account.id] ?? []}
          />
        ))}
      </section>
    </main>
  );
}

function AccountCard({
  account,
  locations,
}: {
  account: MerchantAccountSummary;
  locations: MerchantLocationSummary[];
}) {
  const router = useRouter();
  const controls = dashboardControlsFor(account.role);
  const [externalId, setExternalId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addLocation(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/merchant/accounts/${account.id}/locations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalId, displayName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not add the location.");
      }
      setExternalId("");
      setDisplayName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{account.merchantName}</h3>
        <span className="text-xs rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-1">
          {account.role}
        </span>
      </div>
      {account.website && (
        <p className="text-xs text-neutral-500 break-all">{account.website}</p>
      )}

      <div className="space-y-1">
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">Locations</h4>
        {locations.length === 0 ? (
          <p className="text-sm text-neutral-500">No locations yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {locations.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>{l.displayName}</span>
                <span className="text-neutral-500">{l.externalId}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {controls.canManageLocations && (
        <form onSubmit={addLocation} className="flex flex-wrap gap-2 items-start">
          <input
            aria-label="Location external id"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder="Store / terminal id"
            required
            maxLength={120}
            className="flex-1 min-w-40 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
          <input
            aria-label="Location display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            required
            maxLength={120}
            className="flex-1 min-w-40 rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !externalId.trim() || !displayName.trim()}
            className="rounded bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50"
          >
            Add location
          </button>
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
        </form>
      )}
    </article>
  );
}
