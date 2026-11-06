"use client";

import { Ban } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Shown instead of the app when the platform administrator has blocked this person's shop. */
export function ShopBlocked() {
  const { blocked, session, signOut, refresh } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
        <Ban className="mx-auto size-10 text-destructive" />
        <h1 className="font-display text-2xl font-bold">Shop access blocked</h1>
        <p className="text-sm text-muted-foreground">
          {blocked?.shopName ? <b className="text-foreground">{blocked.shopName}</b> : "Your shop"} has been blocked by the DukaFlow administrator, so it cannot be used right now.
        </p>
        {blocked?.reason ? <p className="rounded-xl bg-muted p-3 text-sm">Reason: {blocked.reason}</p> : null}
        <p className="text-xs text-muted-foreground">Contact the administrator to get access back. Signed in as {session?.user.email}.</p>
        <Button className="w-full" variant="secondary" onClick={() => void refresh()}>
          Check again
        </Button>
        <Button className="w-full" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
