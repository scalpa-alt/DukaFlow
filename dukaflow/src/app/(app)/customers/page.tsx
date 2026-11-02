"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { fetchCustomers, formatMoney, recordRepayment, saveCustomer, type CustomerWithBalance } from "@/lib/shop";

type CustomerForm = { id?: string; name: string; phone: string; credit_limit: number };

export default function CustomersPage() {
  const { t } = usePrefs();
  const { isOwner } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [repayFor, setRepayFor] = useState<CustomerWithBalance | null>(null);
  const [amount, setAmount] = useState("");

  const save = useMutation({
    mutationFn: () => saveCustomer(form!),
    onSuccess: () => {
      toast.success("Customer saved");
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repay = useMutation({
    mutationFn: (method: "cash" | "mpesa") => recordRepayment(repayFor!.id, Number(amount), method),
    onSuccess: (leftOver) => {
      toast.success(leftOver > 0 ? `Repayment saved. ${formatMoney(leftOver)} more than was owed.` : "Repayment saved");
      setRepayFor(null);
      setAmount("");
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const customers = data ?? [];
  const debtors = customers.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance);
  const totalOwed = debtors.reduce((sum, c) => sum + c.balance, 0);
  const repayAmountOk = Number(amount) > 0;

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("customers")}</h1>
        <Button size="sm" onClick={() => setForm({ name: "", phone: "", credit_limit: 1000 })}>
          <Plus className="mr-1 size-4" /> New
        </Button>
      </div>

      {form ? (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Phone (07…)" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="block text-xs text-muted-foreground">
            Credit limit (KSh)
            <Input
              type="number"
              min={0}
              value={form.credit_limit}
              disabled={Boolean(form.id) && !isOwner}
              onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })}
            />
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {t("save")}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">Debtors</h2>
          <span className="text-sm text-muted-foreground">
            Owed: <b className="text-foreground">{formatMoney(totalOwed)}</b>
          </span>
        </div>

        {debtors.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">Nobody owes you money.</p>
        ) : (
          <ul className="divide-y divide-border">
            {debtors.map((c) => (
              <li key={c.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.phone ?? "No phone"} · since {c.oldest ? new Date(c.oldest).toLocaleDateString("en-KE") : "-"}
                      {c.balance > Number(c.credit_limit) ? " · over limit" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-destructive">{formatMoney(c.balance)}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRepayFor(c);
                        setAmount(String(c.balance));
                      }}
                    >
                      Repay
                    </Button>
                  </div>
                </div>
                {repayFor?.id === c.id ? (
                  <div className="mt-2 flex gap-2">
                    <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1" />
                    <Button size="sm" disabled={!repayAmountOk || repay.isPending} onClick={() => repay.mutate("cash")}>
                      Cash
                    </Button>
                    <Button size="sm" disabled={!repayAmountOk || repay.isPending} onClick={() => repay.mutate("mpesa")}>
                      M-Pesa
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Repayments clear the oldest debt first.</p>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-2 font-display text-lg font-semibold">All customers</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : customers.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">No customers yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {customers.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>
                  {c.name} <span className="text-muted-foreground">· limit {formatMoney(c.credit_limit)}</span>
                </span>
                {isOwner ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setForm({ id: c.id, name: c.name, phone: c.phone ?? "", credit_limit: Number(c.credit_limit) })}
                  >
                    Edit
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
