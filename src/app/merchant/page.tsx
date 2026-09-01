import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import {
  listMerchantAccounts,
  listMerchantLocations,
  type MerchantLocationSummary,
} from "@/lib/merchant/service";
import { MerchantDashboard } from "./merchant-dashboard";

export const dynamic = "force-dynamic";

/**
 * Phase 3 Session 1. The merchant dashboard entry point. Reads the caller's
 * accounts and each account's locations server-side so the workspace opens
 * on the truth, then hands them to the client component. Every mutation the
 * client offers goes back through the authenticated API, which re-checks the
 * caller's role — this page is a view, not the authority.
 */
export default async function MerchantPage() {
  const user = await getCurrentUserFromCookies(await cookies());
  if (!user) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold mb-2">Sign in to open your merchant workspace</h1>
        <Link href="/signin" className="rounded bg-emerald-600 text-white px-4 py-2 text-sm">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  const accounts = await listMerchantAccounts(user.userId);
  const locationsByAccount: Record<string, MerchantLocationSummary[]> = {};
  await Promise.all(
    accounts.map(async (account) => {
      locationsByAccount[account.id] = await listMerchantLocations(user.userId, account.id);
    }),
  );

  return <MerchantDashboard accounts={accounts} locationsByAccount={locationsByAccount} />;
}
