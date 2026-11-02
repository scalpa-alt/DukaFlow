"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Store } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { postApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Input } from "@/components/ui";

/** Shown to a signed-in person who has no shop yet: create one, or join one with a code. */
export function ShopSetup() {
  const { session, signOut, refresh } = useAuth();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const createShop = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("create_shop", { p_name: name });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    // The shop exists now. Email the owner the join code for their staff.
    const mail = await postApi("/api/email/join-code");
    if (mail.ok) toast.success(mail.message);
    else toast.message("Shop created. " + mail.message);
    await refresh();
    setBusy(false);
  };

  const joinShop = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("join_shop", { p_code: code });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    await refresh();
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="text-center">
          <Store className="mx-auto size-10 text-primary" />
          <h1 className="mt-2 font-display text-2xl font-bold">Set up your shop</h1>
          <p className="text-sm text-muted-foreground">Signed in as {session?.user.email}</p>
        </div>

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createShop();
          }}
        >
          <h2 className="font-semibold">I own a shop</h2>
          <Input required placeholder="Shop name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" className="w-full" disabled={busy}>
            Create shop
          </Button>
          <p className="text-xs text-muted-foreground">Your shop code will be emailed to {session?.user.email}.</p>
        </form>

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void joinShop();
          }}
        >
          <h2 className="font-semibold">I work at a shop</h2>
          <Input
            required
            placeholder="Shop code from the owner"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Button type="submit" variant="outline" className="w-full" disabled={busy}>
            Join shop
          </Button>
        </form>

        <button className="w-full text-sm text-muted-foreground" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
