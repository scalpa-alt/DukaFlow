import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, PackageCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StockBadge } from "@/components/StockBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustStock, fetchProducts, formatMoney, stockStatus, type Product } from "@/lib/shop";
import { usePrefs } from "@/lib/prefs";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Low stock alerts — DukaFlow" },
      {
        name: "description",
        content: "Every item at or below its low-stock limit, so you know what to restock.",
      },
      { property: "og:title", content: "Low stock alerts — DukaFlow" },
      {
        property: "og:description",
        content: "Every item at or below its low-stock limit, so you know what to restock.",
      },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const { t } = usePrefs();
  const { role } = useAuth();
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const out = (products ?? []).filter((p) => stockStatus(p) === "out");
  const low = (products ?? []).filter((p) => stockStatus(p) === "low");

  return (
    <div className="px-4 pb-6 pt-5">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("lowStockAlerts")}</h1>
        <p className="text-sm text-muted-foreground">
          {out.length} {t("outOfStock").toLowerCase()} · {low.length} {t("runningLow")}
        </p>
      </header>

      {out.length + low.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <PackageCheck className="mx-auto size-8 text-success" />
          <p className="mt-3 font-medium">{t("wellStocked")}</p>
          <p className="text-sm text-muted-foreground">{t("wellStockedHint")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {[...out, ...low].map((p) => (
            <li
              key={p.id}
              className={`rounded-2xl border p-4 shadow-sm ${
                stockStatus(p) === "out"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-warning/50 bg-warning/10"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-display text-base font-semibold">
                    <BellRing className="size-4" /> {p.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatMoney(p.price)} · {p.category} · {t("alertAt")} {p.low_stock_threshold}
                  </p>
                </div>
                <StockBadge product={p} />
              </div>
              {role === "owner" ? (
                <QuickRestock product={p} label={t("restock")} />
              ) : (
                <Button asChild size="sm" variant="secondary" className="mt-3">
                  <Link to="/inventory">{t("restockInInventory")}</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickRestock({ product, label }: { product: Product; label: string }) {
  const qc = useQueryClient();
  const [n, setN] = useState("");
  const m = useMutation({
    mutationFn: () => adjustStock(product, Math.floor(Number(n))),
    onSuccess: (p) => { toast.success(`${p.name}: ${p.quantity}`); setN(""); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e: Error) => { toast.error(e.message); },
  });
  return (
    <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (Number(n) > 0) m.mutate(); }}>
      <Input type="number" min={1} inputMode="numeric" placeholder="+ qty" value={n} onChange={(e) => setN(e.target.value)} className="h-9 w-24" />
      <Button size="sm" type="submit" disabled={m.isPending || !(Number(n) > 0)}>{label}</Button>
    </form>
  );
}
