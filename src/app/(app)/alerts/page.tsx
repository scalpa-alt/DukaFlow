"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, PackageCheck } from "lucide-react";
import { StockBadge } from "@/components/StockBadge";
import { Button, Input, buttonClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { adjustStock, fetchProducts, formatMoney, stockStatus, type Product } from "@/lib/shop";

export default function AlertsPage() {
  const { t } = usePrefs();
  const { isOwner } = useAuth();
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
                stockStatus(p) === "out" ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/10"
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
              {isOwner ? (
                <QuickRestock product={p} label={t("restock")} />
              ) : (
                <Link href="/inventory" className={buttonClass("secondary", "sm", "mt-3")}>
                  {t("restockInInventory")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Type how many arrived and add them to the stock
function QuickRestock({ product, label }: { product: Product; label: string }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");

  const restock = useMutation({
    mutationFn: () => adjustStock(product, Math.floor(Number(amount))),
    onSuccess: (p) => {
      toast.success(`${p.name}: ${p.quantity}`);
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["alert-count"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number(amount) > 0) restock.mutate();
      }}
    >
      <Input type="number" min={1} inputMode="numeric" placeholder="+ qty" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 w-24" />
      <Button type="submit" size="sm" disabled={restock.isPending || !(Number(amount) > 0)}>
        {label}
      </Button>
    </form>
  );
}
