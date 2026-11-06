"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, ChevronDown, ChevronUp, ShieldCheck, Store, UserMinus } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { formatMoney } from "@/lib/shop";
import { supabase } from "@/lib/supabase";

type AdminShop = {
  id: string;
  name: string;
  owner_email: string | null;
  join_code: string;
  created_at: string;
  staff_count: number;
  product_count: number;
  sales_30d: number;
  last_sale_at: string | null;
  blocked: boolean;
  blocked_reason: string;
};

type AdminStaff = { role_id: string; user_id: string; email: string | null; display_name: string | null; role: "owner" | "seller" };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "No sales yet");

export default function AdminPage() {
  const { isPlatformAdmin } = useAuth();
  if (!isPlatformAdmin) {
    return <p className="px-4 pt-10 text-center text-muted-foreground">This page is for the platform administrator.</p>;
  }
  return <AdminShops />;
}

function AdminShops() {
  const { t } = usePrefs();
  const { signOut, session } = useAuth();
  const [openShop, setOpenShop] = useState<string | null>(null);

  const shops = useQuery({
    queryKey: ["admin-shops"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_shops");
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminShop[];
    },
  });

  const queryClient = useQueryClient();
  const setBlocked = useMutation({
    mutationFn: async ({ shop, blocked, reason }: { shop: string; blocked: boolean; reason: string }) => {
      const { error } = await supabase.rpc("admin_set_shop_blocked", { p_shop: shop, p_blocked: blocked, p_reason: reason });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      toast.success(v.blocked ? "Shop blocked. Its owner and staff can no longer use the app." : "Shop unblocked");
      void queryClient.invalidateQueries({ queryKey: ["admin-shops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBlock = (s: AdminShop) => {
    if (s.blocked) {
      if (window.confirm(`Unblock ${s.name}? Its people can use the app again.`)) setBlocked.mutate({ shop: s.id, blocked: false, reason: "" });
      return;
    }
    const reason = window.prompt(`Block ${s.name}? Its owner and staff will be locked out.\n\nReason (they will see this):`, "");
    if (reason === null) return; // cancelled
    setBlocked.mutate({ shop: s.id, blocked: true, reason });
  };

  const list = shops.data ?? [];
  const blockedCount = list.filter((s) => s.blocked).length;
  const totalSales = list.reduce((sum, s) => sum + Number(s.sales_30d), 0);

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("admin")}</h1>
        <p className="text-sm text-muted-foreground">{session?.user.email}</p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Shops</div>
          <div className="font-display text-xl font-bold">{list.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Blocked</div>
          <div className="font-display text-xl font-bold">{blockedCount}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">Sales, 30 days</div>
          <div className="font-display text-xl font-bold">{formatMoney(totalSales)}</div>
        </div>
      </div>

      {shops.isLoading ? <p className="text-center text-muted-foreground">Loading shops…</p> : null}
      {shops.error ? <p className="text-sm text-destructive">{(shops.error as Error).message}</p> : null}
      {!shops.isLoading && list.length === 0 ? <p className="py-6 text-center text-muted-foreground">No shops have been created yet.</p> : null}

      <ul className="space-y-3">
        {list.map((s) => (
          <li key={s.id} className={`rounded-2xl border bg-card p-4 shadow-sm ${s.blocked ? "border-destructive/50" : "border-border"}`}>
            <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpenShop(openShop === s.id ? null : s.id)}>
              <Store className="mt-0.5 size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-semibold">
                  {s.name}
                  {s.blocked ? <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 align-middle text-xs font-medium text-destructive">Blocked</span> : null}
                </span>
                <span className="block truncate text-sm text-muted-foreground">{s.owner_email ?? "No owner"}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Code <b className="tracking-wider text-foreground">{s.join_code}</b> · {s.staff_count} staff · {s.product_count} products
                </span>
                <span className="block text-xs text-muted-foreground">
                  30 days: <b className="text-foreground">{formatMoney(Number(s.sales_30d))}</b> · last sale {fmtDate(s.last_sale_at)}
                </span>
              </span>
              {openShop === s.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            {s.blocked && s.blocked_reason ? <p className="mt-2 text-xs text-destructive">Reason: {s.blocked_reason}</p> : null}
            <Button
              size="sm"
              variant={s.blocked ? "secondary" : "outline"}
              className={`mt-3 w-full ${s.blocked ? "" : "text-destructive"}`}
              disabled={setBlocked.isPending}
              onClick={() => toggleBlock(s)}
            >
              {s.blocked ? <ShieldCheck className="mr-2 size-4" /> : <Ban className="mr-2 size-4" />}
              {s.blocked ? "Unblock shop" : "Block shop"}
            </Button>
            {openShop === s.id ? <StaffList shopId={s.id} /> : null}
          </li>
        ))}
      </ul>

      <Button variant="outline" className="w-full" onClick={() => void signOut()}>
        {t("signOut")}
      </Button>
    </div>
  );
}

function StaffList({ shopId }: { shopId: string }) {
  const queryClient = useQueryClient();

  const staff = useQuery({
    queryKey: ["admin-staff", shopId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_staff", { p_shop: shopId });
      if (error) throw new Error(error.message);
      return (data ?? []) as AdminStaff[];
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-staff", shopId] });
    void queryClient.invalidateQueries({ queryKey: ["admin-shops"] });
  };

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "owner" | "seller" }) => {
      const { error } = await supabase.from("user_roles").update({ role }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Removed from the shop");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-3 border-t border-border pt-3">
      {staff.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {staff.error ? <p className="text-sm text-destructive">{(staff.error as Error).message}</p> : null}
      <ul className="divide-y divide-border text-sm">
        {(staff.data ?? []).map((m) => (
          <li key={m.role_id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.display_name || m.email || m.user_id.slice(0, 8)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {m.email ?? "no email"} · <span className="capitalize">{m.role}</span>
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={setRole.isPending}
              onClick={() => setRole.mutate({ id: m.role_id, role: m.role === "owner" ? "seller" : "owner" })}
            >
              {m.role === "owner" ? "Make seller" : "Make owner"}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 text-destructive"
              aria-label="Remove from shop"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove ${m.email ?? "this person"} from the shop?`)) remove.mutate(m.role_id);
              }}
            >
              <UserMinus className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
