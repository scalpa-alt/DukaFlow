import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { sendJoinCodeEmail } from "@/lib/email.functions";

// Subscriptions were removed: shops no longer expire. The join code is emailed to the owner, not shown in the app.
export type MyShop = { id: string; name: string };

export function isShopActive(_s?: MyShop | null) {
  return true;
}

export function useMyShop(enabled = true) {
  return useQuery({
    queryKey: ["my-shop"],
    enabled,
    queryFn: async () => {
      const { data: id } = await supabase.rpc("current_shop_id");
      if (!id) return null;
      const { data, error } = await supabase.from("shops").select("id,name").eq("id", id as string).maybeSingle();
      if (error) throw error;
      return data as MyShop | null;
    },
  });
}

export function ShopSetup() {
  const { signOut, session } = useAuth();
  const sendCode = useServerFn(sendJoinCodeEmail);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, emailCode = false) => {
    setBusy(true);
    const { error } = await fn();
    if (error) { setBusy(false); toast.error(error.message); return; }
    if (emailCode) {
      try {
        const r = await sendCode();
        if (r.ok) toast.success(r.message); else toast.error(r.message);
      } catch {
        toast.error("Shop created, but the code email failed. You can resend it from Settings.");
      }
    }
    localStorage.removeItem("dukaflow.role");
    setTimeout(() => window.location.reload(), emailCode ? 1800 : 0);
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="text-center">
          <Store className="mx-auto size-10 text-primary" />
          <h1 className="mt-2 font-display text-2xl font-bold">Set up your shop</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}</p>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => supabase.rpc("create_shop", { p_name: name }), true); }}>
          <h2 className="font-semibold">I own a shop</h2>
          <Input required placeholder="Shop name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button className="w-full" disabled={busy}>Create shop</Button>
          <p className="text-xs text-muted-foreground">Your shop code will be emailed to {session?.user.email}.</p>
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

// Kept so existing imports keep working. Shops are never locked any more.
export function ShopLocked(_props: { shop?: MyShop }) {
  return null;
}
