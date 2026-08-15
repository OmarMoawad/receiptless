import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fromMinorUnits } from "@/lib/money";
import {
  AnnualBarChart,
  CategoryPieChart,
  MonthlyBarChart,
} from "@/components/SpendCharts";

export const dynamic = "force-dynamic";

// Found via a real click-through: both queries below used to run with no
// ownerId filter at all, aggregating every user's spend together — this
// page bypasses /api/reports/* entirely (its own direct Prisma queries),
// so it never inherited Session 3's tenant-isolation work. Fixed the same
// way those routes already are.
async function getMonthlyData(ownerId: string, year: number) {
  const receipts = await prisma.receipt.findMany({
    where: {
      ownerId,
      purchasedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
    },
  });

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    total: 0,
  }));
  const byCategory: Record<string, number> = {};

  for (const r of receipts) {
    const amount = fromMinorUnits(r.totalMinor);
    months[r.purchasedAt.getMonth()].total += amount;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + amount;
  }

  return { months, byCategory, count: receipts.length };
}

async function getAnnualData(ownerId: string) {
  const receipts = await prisma.receipt.findMany({ where: { ownerId } });
  const byYear: Record<number, number> = {};
  for (const r of receipts) {
    const y = r.purchasedAt.getFullYear();
    byYear[y] = (byYear[y] ?? 0) + fromMinorUnits(r.totalMinor);
  }
  return Object.entries(byYear)
    .map(([year, total]) => ({ year: Number(year), total }))
    .sort((a, b) => a.year - b.year);
}

export default async function Home() {
  const cookieStore = await cookies();
  const user = await getCurrentUserFromCookies(cookieStore);
  if (!user) {
    return (
      <main className="flex flex-col items-center gap-2 p-6 text-center">
        <h1 className="text-xl font-semibold">receiptless</h1>
        <p className="text-neutral-500 text-sm">Sign in to see your spend.</p>
        {/*
          This page told people to sign in and offered no way to do it —
          there was no sign-in UI in the application at all until the
          Session 10 slice. A dead end with instructions is still a dead end.
        */}
        <Link href="/signin" className="rounded bg-emerald-600 text-white px-4 py-2 text-sm">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  const currentYear = new Date().getFullYear();
  const [{ months, byCategory, count }, annual] = await Promise.all([
    getMonthlyData(user.userId, currentYear),
    getAnnualData(user.userId),
  ]);

  const yearTotal = months.reduce((sum, m) => sum + m.total, 0);

  return (
    <main className="flex flex-col gap-8 p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">receiptless</h1>
          <p className="text-sm text-neutral-500">
            Every receipt. Automatically. Forever.
          </p>
        </div>
        <Link
          href="/receipts/new"
          className="rounded bg-emerald-600 text-white px-4 py-2 text-sm"
        >
          + Add receipt
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <p className="text-sm text-neutral-500">{currentYear} total</p>
          <p className="text-2xl font-semibold">${yearTotal.toFixed(2)}</p>
        </div>
        <div className="border rounded p-4">
          <p className="text-sm text-neutral-500">Receipts this year</p>
          <p className="text-2xl font-semibold">{count}</p>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-medium mb-2">Monthly spend, {currentYear}</h2>
        <MonthlyBarChart data={months} />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Spend by category</h2>
        <CategoryPieChart data={byCategory} />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-2">Annual spend</h2>
        <AnnualBarChart data={annual} />
      </section>

      <Link href="/receipts" className="text-sm text-emerald-600 underline">
        View all receipts →
      </Link>
    </main>
  );
}
