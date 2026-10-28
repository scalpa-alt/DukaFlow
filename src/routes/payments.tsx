import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePrefs } from "@/lib/prefs";
import {
  fetchMpesaPayments, fetchPendingSales, fetchSale, formatMoney, matchPaymentToSale,
  type MpesaPayment, type Sale,
} from "@/lib/shop";

export const Route = createFileRoute("/payments")({
  validateSearch: (s: Record<string, unknown>): { sale?: string } => {
    const v = s["sale"];
    return typeof v === "string" && v ? { sale: v } : {};
  },
  head: () => ({
    meta: [
      { title: "Payments — DukaFlow" },
      { name: "description", content: "Confirm payment for a sale and match incoming M-Pesa payments." },
      { property: "og:title", content: "Payments — DukaFlow" },
      { property: "og:description", content: "Confirm payment for a sale and match incoming M-Pesa payments." },
    ],
  }),
  component: PaymentsPage,
});

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function PaymentsPage() {
  const { t } = usePrefs();
  const { sale: saleId } = Route.useSearch();
  const qc = useQueryClient();

  const current = useQuery({
    queryKey: ["sale", saleId],
    enabled: !!saleId,
    queryFn: () => fetchSale(saleId as string),
    // The M-Pesa callback marks the sale paid on its own, so keep checking while it is pending.
    refetchInterval: (q) => (q.state.data?.sale.payment_status === "pending" ? 5000 : false),
  });
  const pending = useQuery({ queryKey: ["pending-sales"], queryFn: fetchPendingSales, refetchInterval: 8000 });
  const payments = useQuery({ queryKey: ["mpesa-payments"], queryFn: fetchMpesaPayments, refetchInterval: 8000 });

  const match = useMutation({
    mutationFn: ({ paymentId, saleId: s }: { paymentId: string; saleId: string }) => matchPaymentToSale(paymentId, s),
    onSuccess: () => {
      toast.success("Payment matched to the sale");
      void qc.invalidateQueries({ queryKey: ["mpesa-payments"] });
      void qc.invalidateQueries({ queryKey: ["pending-sales"] });
      void qc.invalidateQueries({ queryKey: ["sale"] });
      void qc.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sale = current.data?.sale;
  const unmatched = (payments.data ?? []).filter((p) => !p.matched_sale_id);
  const recent = (payments.data ?? []).filter((p) => p.matched_sale_id).slice(0, 5);

  return (
    <div className="space-y-5 px-4 pb-6 pt-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t("payment")}</h1>

      {saleId ? (
        <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
          {current.isLoading ? <p className="text-muted-foreground">Loading sale…</p> : null}
          {!current.isLoading && !sale ? <p className="text-muted-foreground">Sale not found.</p> : null}
          {sale ? <SaleStatus sale={sale} items={current.data?.items.length ?? 0} /> : null}
          <Button asChild className="mt-4 w-full"><Link to="/">New sale</Link></Button>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><Smartphone className="size-5" />Incoming M-Pesa</h2>
        {unmatched.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No unmatched payments right now. New M-Pesa payments appear here automatically.</p>
        ) : (
          <ul className="space-y-3">
            {unmatched.map((p) => (
              <PaymentRow key={p.id} payment={p} sales={pending.data ?? []} preferred={saleId} busy={match.isPending}
                onMatch={(s) => match.mutate({ paymentId: p.id, saleId: s })} />
            ))}
          </ul>
        )}
      </section>

      {(pending.data ?? []).length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold">{t("mpesaPending")}</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
            {(pending.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-muted-foreground">{fmtTime(s.created_at)} · {s.item_count} items</span>
                <span className="font-semibold">{formatMoney(Number(s.total))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-semibold">Recently matched</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="min-w-0 truncate">{p.payer_name ?? p.payer_phone ?? "M-Pesa"} <span className="text-muted-foreground">· {p.transaction_id}</span></span>
                <span className="font-semibold text-success">{formatMoney(Number(p.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SaleStatus({ sale, items }: { sale: Sale; items: number }) {
  const { t } = usePrefs();
  const paid = sale.payment_status === "paid";
  const methodLabel = sale.payment_method === "cash" ? t("cash") : sale.payment_method === "mpesa" ? t("mpesa") : t("credit");
  return (
    <div className="space-y-1">
      {paid ? <CheckCircle2 className="mx-auto size-10 text-success" /> : <Clock className="mx-auto size-10 text-warning" />}
      <p className="font-display text-xl font-bold">
        {paid ? t("paid") : sale.payment_status === "pending" ? t("pending") : t("unpaid")}
      </p>
      <p className="text-sm text-muted-foreground">{methodLabel} · {items || sale.item_count} items</p>
      <p className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">{paid ? t("total") : t("amountDue")}</p>
      <p className="font-display text-3xl font-bold">{formatMoney(Number(sale.total))}</p>
      {sale.payment_status === "pending" ? (
        <p className="pt-2 text-sm text-muted-foreground">Waiting for the customer's M-Pesa payment. This screen updates by itself, or match a payment below.</p>
      ) : null}
    </div>
  );
}

function PaymentRow({
  payment, sales, preferred, busy, onMatch,
}: { payment: MpesaPayment; sales: Sale[]; preferred: string | undefined; busy: boolean; onMatch: (saleId: string) => void }) {
  const sameAmount = sales.find((s) => Number(s.total) === Number(payment.amount));
  const initial = (preferred && sales.some((s) => s.id === preferred) ? preferred : sameAmount?.id) ?? "";
  const [choice, setChoice] = useState(initial);
  return (
    <li className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{payment.payer_name ?? payment.payer_phone ?? "M-Pesa payment"}</p>
          <p className="truncate text-xs text-muted-foreground">{payment.transaction_id} · {fmtTime(payment.paid_at)}</p>
        </div>
        <p className="font-display text-lg font-bold">{formatMoney(Number(payment.amount))}</p>
      </div>
      {sales.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pending M-Pesa sales to match this to.</p>
      ) : (
        <div className="flex gap-2">
          <select aria-label="Pending sale" className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose a pending sale…</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>{formatMoney(Number(s.total))} · {fmtTime(s.created_at)}</option>
            ))}
          </select>
          <Button size="sm" disabled={!choice || busy} onClick={() => onMatch(choice)}>Match</Button>
        </div>
      )}
    </li>
  );
}
