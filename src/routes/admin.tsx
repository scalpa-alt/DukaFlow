import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/shop";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Platform Admin — DukaFlow" },
      { name: "description", content: "Manage shops, users and subscriptions." },
      { property: "og:title", content: "Platform Admin — DukaFlow" },
      { property: "og:description", content: "Manage shops, users and subscriptions." },
    ],
  }),
  component: AdminPage,
});

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—");

function AdminPage() {
  const { isPlatformAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const { data: shops } = useQuery({
    queryKey: ["admin", "shops"],
    enabled: isPlatformAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_shops");
      if (error) throw error;
      return data ?? [];
    },
  });

  const update = async (p_shop: string, args: { p_add_months?: number; p_suspended?: boolean; p_extend_trial_days?: number }) => {
    const { error } = await supabase.rpc("admin_update_shop", { p_shop, ...args });
    if (error) { toast.error(error.message); return; }
    toast.success("Shop updated");
    void qc.invalidateQueries({ queryKey: ["admin", "shops"] });
  };

  if (loading) return <div className="p-6 text-center text-muted-foreground">Loading…</div>;
  if (!isPlatformAdmin) return <div className="p-6 text-center text-muted-foreground">This page is for the platform admin only.</div>;

  const list = shops ?? [];
  const active = list.filter((s) => s.active).length;
  const monthly = list.filter((s) => s.active && !!s.paid_until && new Date(s.paid_until) > new Date()).reduce((a, s) => a + Number(s.monthly_fee), 0);

  return (
    <div className="space-y-5 px-4 pb-6 pt-5">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
        <ShieldCheck className="size-6 text-primary" /> Platform Admin
      </h1>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Shops" value={String(list.length)} />
        <Stat label="Active" value={String(active)} />
        <Stat label="Paid / month" value={formatMoney(monthly)} />
      </div>
      {list.length === 0 ? <p className="text-center text-sm text-muted-foreground">No shops yet. Shops appear here when owners sign up.</p> : null}
      {list.map((s) => (
        <section key={s.id} className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold">{s.name}</h2>
              <p className="text-muted-foreground">{s.owner_email ?? "—"} · code {s.join_code}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.suspended ? "bg-destructive/15 text-destructive" : s.active ? "bg-success/15 text-success" : "bg-warning/25 text-warning-foreground"}`}>
              {s.suspended ? "Suspended" : s.active ? "Active" : "Expired"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Trial ends: {fmt(s.trial_ends_at)}</span>
            <span>Paid until: {fmt(s.paid_until)}</span>
            <span>Staff: {s.staff_count} · Products: {s.product_count}</span>
            <span>Sales 30d: {formatMoney(Number(s.sales_30d))}</span>
            <span>Last sale: {fmt(s.last_sale_at)}</span>
            <span>Fee: {formatMoney(Number(s.monthly_fee))}/mo</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => void update(s.id, { p_add_months: 1 })}>+1 month paid</Button>
            <Button size="sm" variant="outline" onClick={() => void update(s.id, { p_extend_trial_days: 7 })}>+7 trial days</Button>
            <Button size="sm" variant={s.suspended ? "secondary" : "destructive"} onClick={() => void update(s.id, { p_suspended: !s.suspended })}>
              {s.suspended ? "Unsuspend" : "Suspend"}
            </Button>
          </div>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="font-display text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
