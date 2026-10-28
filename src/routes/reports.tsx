import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { fetchExpenses, fetchSalesRange, formatMoney, startOfDay } from "@/lib/shop";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — DukaFlow" },
      { name: "description", content: "Daily, weekly and monthly sales, best sellers and profit." },
      { property: "og:title", content: "Reports — DukaFlow" },
      { property: "og:description", content: "Daily, weekly and monthly sales, best sellers and profit." },
    ],
  }),
  component: ReportsPage,
});

type Range = "today" | "week" | "month" | "custom";

const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const localDay = (iso: string) => ymd(new Date(iso));

function rangeFor(r: Range, from: string, to: string): { start: Date; end: Date } {
  const now = new Date();
  if (r === "today") return { start: startOfDay(now), end: now };
  if (r === "week") { const s = startOfDay(now); s.setDate(s.getDate() - 6); return { start: s, end: now }; }
  if (r === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  const s = new Date(`${from}T00:00:00`);
  const e = new Date(`${to}T23:59:59.999`);
  return { start: s, end: e };
}

function ReportsPage() {
  const { t } = usePrefs();
  const { isOwner } = useAuth();
  const [range, setRange] = useState<Range>("today");
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(ymd(new Date()));

  const { start, end } = rangeFor(range, from, to);
  const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end;
  const key = [range, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];

  const data = useQuery({ queryKey: ["report", ...key], enabled: valid, queryFn: () => fetchSalesRange(start, end) });
  const expenses = useQuery({
    queryKey: ["report-expenses", ...key],
    enabled: valid && isOwner,
    queryFn: () => fetchExpenses(ymd(start), ymd(end)),
  });

  const stats = useMemo(() => {
    const sales = data.data?.sales ?? [];
    const items = data.data?.items ?? [];
    const revenue = sales.reduce((a, s) => a + Number(s.total), 0);
    const itemsSold = items.reduce((a, i) => a + Number(i.quantity), 0);

    const byMethod = new Map<string, { total: number; count: number }>();
    for (const s of sales) {
      const m = byMethod.get(s.payment_method) ?? { total: 0, count: 0 };
      m.total += Number(s.total); m.count += 1;
      byMethod.set(s.payment_method, m);
    }

    const best = new Map<string, { name: string; qty: number; total: number }>();
    for (const i of items) {
      const k = i.product_id ?? i.product_name;
      const b = best.get(k) ?? { name: i.product_name, qty: 0, total: 0 };
      b.qty += Number(i.quantity); b.total += Number(i.line_total);
      best.set(k, b);
    }

    const perDay = new Map<string, number>();
    const cursor = startOfDay(start);
    while (cursor <= end && perDay.size < 400) { perDay.set(ymd(cursor), 0); cursor.setDate(cursor.getDate() + 1); }
    for (const s of sales) { const d = localDay(s.created_at); perDay.set(d, (perDay.get(d) ?? 0) + Number(s.total)); }

    return {
      revenue, itemsSold, count: sales.length,
      byMethod: [...byMethod.entries()].sort((a, b) => b[1].total - a[1].total),
      best: [...best.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
      chart: [...perDay.entries()].map(([d, total]) => ({ day: d.slice(5), total })),
    };
  }, [data.data, start, end]);

  const spent = (expenses.data ?? []).reduce((a, e) => a + Number(e.amount), 0);
  const methodLabel = (m: string) => (m === "cash" ? t("cash") : m === "mpesa" ? t("mpesa") : m === "credit" ? t("credit") : m);
  const tabs: [Range, string][] = [["today", t("today")], ["week", t("week")], ["month", t("month")], ["custom", t("custom")]];

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t("reports")}</h1>

      <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
        {tabs.map(([r, label]) => (
          <button key={r} onClick={() => setRange(r)}
            className={`rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${range === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
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
        {isOwner ? <Stat label={t("netProfit")} value={formatMoney(stats.revenue - spent)} hint={`${t("revenue")} − ${t("expenses").toLowerCase()} ${formatMoney(spent)}`} /> : null}
        <Stat label={t("salesCount")} value={String(stats.count)} />
        <Stat label={t("itemsSold")} value={String(stats.itemsSold)} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 font-display text-lg font-semibold">{t("revenueByDay")}</h2>
        {data.isLoading ? <p className="py-8 text-center text-muted-foreground">Loading…</p> : stats.count === 0 ? (
          <p className="py-8 text-center text-muted-foreground">{t("noSales")}</p>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chart} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => formatMoney(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
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
            {stats.byMethod.map(([m, v]) => (
              <li key={m} className="flex justify-between py-2">
                <span>{methodLabel(m)} <span className="text-muted-foreground">· {v.count}</span></span>
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
            {stats.best.map((b, i) => (
              <li key={b.name + i} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate"><span className="mr-2 text-muted-foreground">{i + 1}.</span>{b.name}</span>
                <span className="shrink-0 text-right"><span className="font-semibold">{b.qty}</span> <span className="text-muted-foreground">· {formatMoney(b.total)}</span></span>
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
