import Link from "next/link";
import { prisma } from "@/lib/db";
import { fromMinorUnits } from "@/lib/money";
import {
  AnnualBarChart,
  CategoryPieChart,
  MonthlyBarChart,
} from "@/components/SpendCharts";

export const dynamic = "force-dynamic";

async function getMonthlyData(year: number) {
  const receipts = await prisma.receipt.findMany({
    where: {
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

async function getAnnualData() {
  const receipts = await prisma.receipt.findMany();
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
  const currentYear = new Date().getFullYear();
  const [{ months, byCategory, count }, annual] = await Promise.all([
    getMonthlyData(currentYear),
    getAnnualData(),
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
