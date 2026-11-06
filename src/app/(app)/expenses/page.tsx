"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button, Input, selectClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { EXPENSE_CATEGORIES, deleteExpense, fetchExpenses, formatMoney, saveExpense, type ExpenseCategory } from "@/lib/shop";

// Today's date in the phone's own time zone, as YYYY-MM-DD
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

type Form = { id?: string; category: ExpenseCategory; description: string; amount: string; date: string };

export default function ExpensesPage() {
  const { isOwner } = useAuth();
  if (!isOwner) {
    return <p className="px-4 pt-10 text-center text-muted-foreground">Expenses are for the shop owner only.</p>;
  }
  return <Expenses />;
}

function Expenses() {
  const { t } = usePrefs();
  const queryClient = useQueryClient();

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [filter, setFilter] = useState<"" | ExpenseCategory>("");
  const blank: Form = { category: "other", description: "", amount: "", date: today() };
  const [form, setForm] = useState<Form>(blank);

  const { data } = useQuery({ queryKey: ["expenses", from, to], queryFn: () => fetchExpenses(from, to) });
  const list = (data ?? []).filter((e) => !filter || e.category === filter);
  const total = list.reduce((sum, e) => sum + Number(e.amount), 0);

  const save = useMutation({
    mutationFn: () => {
      const amount = Number(form.amount);
      if (!(amount > 0)) throw new Error("Enter an amount above 0");
      return saveExpense({ ...form, amount });
    },
    onSuccess: () => {
      toast.success("Expense saved");
      setForm(blank);
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["report-expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["report-expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t("expenses")}</h1>

      <form
        className="space-y-2 rounded-2xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="font-semibold">{form.id ? "Edit expense" : "Add expense"}</p>
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Category" className={selectClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Input placeholder="Amount (KSh)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={save.isPending}>
            {t("save")}
          </Button>
          {form.id ? (
            <Button type="button" variant="ghost" onClick={() => setForm(blank)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <div className="grid grid-cols-3 gap-2">
        <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <select aria-label="Filter category" className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value as "" | ExpenseCategory)}>
          <option value="">All</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex justify-between border-b border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t("total")}</span>
          <span className="font-bold">{formatMoney(total)}</span>
        </div>
        <ul className="divide-y divide-border text-sm">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t(e.category)} · {formatMoney(Number(e.amount))}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.date}
                  {e.description ? ` · ${e.description}` : ""}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Edit"
                onClick={() => setForm({ id: e.id, category: e.category, description: e.description, amount: String(e.amount), date: e.date })}
              >
                <Pencil className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label="Delete" onClick={() => remove.mutate(e.id)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
          {list.length === 0 ? <li className="px-4 py-6 text-center text-muted-foreground">No expenses in this period.</li> : null}
        </ul>
      </div>
    </div>
  );
}
