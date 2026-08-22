import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { knownCurrencies } from "@/lib/fx/currency-metadata";
import { ReportingCurrencyForm } from "./reporting-currency-form";
import { FxReconciliation } from "./fx-reconciliation";

export const dynamic = "force-dynamic";

/**
 * Session 7. The one setting there is so far: the reporting currency.
 *
 * A whole page for a single control is deliberate — this is where account
 * settings will accrue, and giving them a home now is cheaper than
 * retrofitting one. It reads the value server-side so the form opens on
 * the truth, not on a default.
 */
export default async function SettingsPage() {
  const user = await getCurrentUserFromCookies(await cookies());
  if (!user) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-lg font-semibold mb-2">Sign in to change your settings</h1>
        <Link href="/signin" className="rounded bg-emerald-600 text-white px-4 py-2 text-sm">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.userId },
    select: { reportingCurrency: true },
  });

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Link href="/receipts" className="text-sm text-neutral-500">
          Back to your vault
        </Link>
      </div>

      <section className="space-y-3">
        <ReportingCurrencyForm current={row.reportingCurrency} currencies={knownCurrencies()} />
        <p className="text-xs text-neutral-500 max-w-prose">
          Every total in your tax summary and reports is expressed in this currency. A
          receipt already in it is counted as-is; a receipt in another currency is
          converted using the rate stored on it when it was added — never
          today&apos;s rate.
        </p>
        <p className="text-xs text-neutral-500 max-w-prose">
          Changing this does not rewrite receipts you already have. Ones that now
          match this currency stop being converted and are counted directly; ones in
          a currency with no rate on file show as &ldquo;not included&rdquo; in the
          summary until you enter a rate for them. Nothing you may have already filed
          is silently restated.
        </p>
      </section>

      <section className="space-y-3 border-t border-neutral-200 dark:border-neutral-800 pt-6">
        <FxReconciliation reportingCurrency={row.reportingCurrency} />
        <p className="text-xs text-neutral-500 max-w-prose">
          Changing your reporting currency never rewrites past receipts on its own.
          This is where you ask for that work explicitly: preview how many receipts
          are affected, then apply it in batches. Nothing you may already have filed
          is restated without you choosing it here.
        </p>
      </section>
    </main>
  );
}
