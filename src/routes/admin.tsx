import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
      { name: "description", content: "Manage shops, owners and sellers." },
      { property: "og:title", content: "Platform Admin — DukaFlow" },
      { property: "og:description", content: "Manage shops, owners and sellers." },
    ],
  }),
  component: AdminPage,
});

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—");

type ShopRow = {
  id: string; name: string; owner_email: string | null; join_code: string; created_at: string;
  staff_count: number; product_count: number; sales_30d: number | string; last_sale_at: string | null;
};
type StaffRow = { role_id: string; user_id: string; email: string | null; display_name: string | null; role: "owner" | "seller" };

// Loosely typed so this compiles before the generated Supabase types include the new functions.
const rpc = <T,>(fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message: string } | null }>).call(supabase, fn, args);

function AdminPage() {
  const { isPlatformAdmin, loading } = useAuth();
  const { data: shops } = useQuery({
    queryKey: ["admin", "shops"],
    enabled: isPlatformAdmin,
    queryFn: async () => {
      const { data, error } = await rpc<ShopRow[]>("admin_list_shops");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  if (loading) return <div className="p-6 text-center text-muted-foreground">Loading…</div>;
  if (!isPlatformAdmin) return <div className="p-6 text-center text-muted-foreground">This page is for the platform admin only.</div>;

  const list = shops ?? [];
  const sellers = list.reduce((a, s) => a + Math.max(0, Number(s.staff_count) - 1), 0);

  return (
    <div className="space-y-5 px-4 pb-6 pt-5">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
        <ShieldCheck className="size-6 text-primary" /> Platform Admin
      </h1>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Shops" value={String(list.length)} />
        <Stat label="Staff (approx.)" value={String(sellers + list.length)} />
        <Stat label="Sales 30d" value={formatMoney(list.reduce((a, s) => a + Number(s.sales_30d), 0))} />
      </div>
      {list.length === 0 ? <p className="text-center text-sm text-muted-foreground">No shops yet. Shops appear here when owners sign up.</p> : null}
      {list.map((s) => <ShopCard key={s.id} shop={s} />)}
    </div>
  );
}

function ShopCard({ shop: s }: { shop: ShopRow }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const staff = useQuery({
    queryKey: ["admin", "staff", s.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await rpc<StaffRow[]>("admin_list_staff", { p_shop: s.id });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "staff", s.id] });
    void qc.invalidateQueries({ queryKey: ["admin", "shops"] });
  };
  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "owner" | "seller" | null }) => {
      const { error } = role
        ? await supabase.from("user_roles").update({ role }).eq("id", id)
        : await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Updated"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
      <div>
        <h2 className="font-display text-lg font-semibold">{s.name}</h2>
        <p className="text-muted-foreground">{s.owner_email ?? "—"} · code {s.join_code}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Joined: {fmt(s.created_at)}</span>
        <span>Staff: {s.staff_count} · Products: {s.product_count}</span>
        <span>Sales 30d: {formatMoney(Number(s.sales_30d))}</span>
        <span>Last sale: {fmt(s.last_sale_at)}</span>
      </div>
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>{open ? "Hide staff" : "Owners & sellers"}</Button>
      {open ? (
        <ul className="divide-y divide-border">
          {staff.isLoading ? <li className="py-2 text-muted-foreground">Loading…</li> : null}
          {(staff.data ?? []).map((m) => (
            <li key={m.role_id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {m.display_name || m.email || "Staff"} <span className="text-muted-foreground">· {m.role}</span>
                {m.email && m.display_name ? <span className="block text-xs text-muted-foreground">{m.email}</span> : null}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={setRole.isPending} onClick={() => setRole.mutate({ id: m.role_id, role: m.role === "owner" ? "seller" : "owner" })}>
                  Make {m.role === "owner" ? "seller" : "owner"}
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={setRole.isPending}
                  onClick={() => { if (window.confirm(`Remove ${m.display_name || m.email || "this person"} from ${s.name}?`)) setRole.mutate({ id: m.role_id, role: null }); }}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
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
