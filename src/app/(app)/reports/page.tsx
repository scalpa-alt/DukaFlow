"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Input, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { fetchExpenses, fetchSalesRange, formatMoney, startOfDay } from "@/lib/shop";

type Range = "today" | "week" | "month" | "custom";

// "2026-11-01" in the phone's own time zone
const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function rangeFor(range: Range, from: string, to: string): { start: Date; end: Date } {
  const now = new Date();
  if (range === "today") return { start: startOfDay(now), end: now };
  if (range === "week") {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 6);
    return { start, end: now };
  }
  if (range === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  return { start: new Date(`${from}T00:00:00`), end: new Date(`${to}T23:59:59.999`) };
}

export default function ReportsPage() {
  const { t } = usePrefs();
  const { isOwner } = useAuth();
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(ymd(new Date()));

  const { start, end } = rangeFor(range, from, to);
  const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end;
  const cacheKey = [range, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];

  const sales = useQuery({ queryKey: ["report", ...cacheKey], enabled: valid, queryFn: () => fetchSalesRange(start, end) });
  // Expenses are for owners only
  const expenses = useQuery({
    queryKey: ["report-expenses", ...cacheKey],
    enabled: valid && isOwner,
    queryFn: () => fetchExpenses(ymd(start), ymd(end)),
  });

  const stats = useMemo(() => {
    const saleRows = sales.data?.sales ?? [];
    const itemRows = sales.data?.items ?? [];

    const revenue = saleRows.reduce((sum, s) => sum + Number(s.total), 0);
    const itemsSold = itemRows.reduce((sum, i) => sum + Number(i.quantity), 0);

    const byMethod = new Map<string, { total: number; count: number }>();
    for (const s of saleRows) {
      const entry = byMethod.get(s.payment_method) ?? { total: 0, count: 0 };
      entry.total += Number(s.total);
      entry.count += 1;
      byMethod.set(s.payment_method, entry);
    }

    const best = new Map<string, { name: string; qty: number; total: number }>();
    for (const i of itemRows) {
      const key = i.product_id ?? i.product_name;
      const entry = best.get(key) ?? { name: i.product_name, qty: 0, total: 0 };
      entry.qty += Number(i.quantity);
      entry.total += Number(i.line_total);
      best.set(key, entry);
    }

    // Every day in the range gets a bar, even days with no sales
    const perDay = new Map<string, number>();
    const cursor = startOfDay(start);
    while (cursor <= end && perDay.size < 400) {
      perDay.set(ymd(cursor), 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    for (const s of saleRows) {
      const day = ymd(new Date(s.created_at));
      perDay.set(day, (perDay.get(day) ?? 0) + Number(s.total));
    }

    return {
      revenue,
      itemsSold,
      count: saleRows.length,
      byMethod: [...byMethod.entries()].sort((a, b) => b[1].total - a[1].total),
      best: [...best.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
      chart: [...perDay.entries()].map(([day, total]) => ({ day: day.slice(5), total })),
    };
    // start and end are rebuilt on every render, so depend on the loaded data and the chosen range
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales.data, range, from, to]);

  const spent = (expenses.data ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  const methodLabel = (m: string) => (m === "cash" ? t("cash") : m === "mpesa" ? t("mpesa") : m === "credit" ? t("credit") : m);
  const tabs: [Range, string][] = [
    ["today", t("today")],
    ["week", t("week")],
    ["month", t("month")],
    ["custom", t("custom")],
  ];

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t("reports")}</h1>

      <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            className={cn(
              "rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
              range === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {range === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
      ) : null}
      {!valid ? <p className="text-sm text-destructive">Pick a valid date range.</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <Stat label={t("revenue")} value={formatMoney(stats.revenue)} />
        {isOwner ? (
          <Stat label={t("netProfit")} value={formatMoney(stats.revenue - spent)} hint={`${t("revenue")} − ${t("expenses").toLowerCase()} ${formatMoney(spent)}`} />
        ) : null}
        <Stat label={t("salesCount")} value={String(stats.count)} />
        <Stat label={t("itemsSold")} value={String(stats.itemsSold)} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">{t("revenueByDay")}</h2>
        {sales.isLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading…</p>
        ) : stats.count === 0 ? (
          <p className="py-8 text-center text-muted-foreground">{t("noSales")}</p>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chart} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value: number) => formatMoney(value)}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
                />
                <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {stats.byMethod.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">{t("byMethod")}</h2>
          <ul className="divide-y divide-border text-sm">
            {stats.byMethod.map(([method, v]) => (
              <li key={method} className="flex justify-between py-2">
                <span>
                  {methodLabel(method)} <span className="text-muted-foreground">· {v.count}</span>
                </span>
                <span className="font-semibold">{formatMoney(v.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {stats.best.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">{t("bestSellers")}</h2>
          <ol className="divide-y divide-border text-sm">
            {stats.best.map((b, index) => (
              <li key={b.name + index} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-muted-foreground">{index + 1}.</span>
                  {b.name}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-semibold">{b.qty}</span> <span className="text-muted-foreground">· {formatMoney(b.total)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-bold">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
