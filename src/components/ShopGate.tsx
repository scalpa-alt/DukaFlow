import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";

export type MyShop = { id: string; name: string; join_code: string; trial_ends_at: string; paid_until: string | null; suspended: boolean; monthly_fee: number };

export function isShopActive(s: MyShop) {
  const now = Date.now();
  return !s.suspended && (new Date(s.trial_ends_at).getTime() > now || (!!s.paid_until && new Date(s.paid_until).getTime() > now));
}

export function useMyShop(enabled = true) {
  return useQuery({
    queryKey: ["my-shop"],
    enabled,
    queryFn: async () => {
      const { data: id } = await supabase.rpc("current_shop_id");
      if (!id) return null;
      const { data, error } = await supabase.from("shops").select("id,name,join_code,trial_ends_at,paid_until,suspended,monthly_fee").eq("id", id as string).maybeSingle();
      if (error) throw error;
      return data as MyShop | null;
    },
  });
}

export function ShopSetup() {
  const { signOut, session } = useAuth();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    localStorage.removeItem("dukaflow.role");
    window.location.reload();
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="text-center">
          <Store className="mx-auto size-10 text-primary" />
          <h1 className="mt-2 font-display text-2xl font-bold">Set up your shop</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}</p>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => supabase.rpc("create_shop", { p_name: name })); }}>
          <h2 className="font-semibold">I own a shop</h2>
          <Input required placeholder="Shop name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button className="w-full" disabled={busy}>Create shop (14-day free trial)</Button>
        </form>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => supabase.rpc("join_shop", { p_code: code })); }}>
          <h2 className="font-semibold">I work at a shop</h2>
          <Input required placeholder="Shop code from the owner" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <Button variant="outline" className="w-full" disabled={busy}>Join shop</Button>
        </form>
        <button className="w-full text-sm text-muted-foreground" onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}

export function ShopLocked({ shop }: { shop: MyShop }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-sm space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
        <Lock className="mx-auto size-10 text-destructive" />
        <h1 className="font-display text-xl font-bold">{shop.name} is locked</h1>
        <p className="text-sm text-muted-foreground">
          {shop.suspended ? "This shop has been suspended." : "The free trial or subscription has ended."} Please contact the DukaFlow provider to renew
          (KSh {Number(shop.monthly_fee).toLocaleString("en-KE")} per month). Your data is safe.
        </p>
        <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
      </div>
    </div>
  );
}
