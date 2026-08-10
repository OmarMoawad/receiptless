"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const COLORS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

export function MonthlyBarChart({
  data,
}: {
  data: { month: number; total: number }[];
}) {
  const chartData = data.map((d) => ({
    name: MONTH_LABELS[d.month - 1],
    total: Number(d.total.toFixed(2)),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="name" fontSize={12} />
        <YAxis fontSize={12} />
        <Tooltip />
        <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryPieChart({
  data,
}: {
  data: Record<string, number>;
}) {
  const chartData = Object.entries(data).map(([name, value]) => ({
    name,
    value: Number(value.toFixed(2)),
  }));

  if (chartData.length === 0) {
    return <p className="text-sm text-neutral-500">No category data yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={90} label>
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function AnnualBarChart({
  data,
}: {
  data: { year: number; total: number }[];
}) {
  const chartData = data.map((d) => ({
    name: String(d.year),
    total: Number(d.total.toFixed(2)),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey="name" fontSize={12} />
        <YAxis fontSize={12} />
        <Tooltip />
        <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
