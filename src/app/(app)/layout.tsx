"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getQueue, syncQueue } from "@/lib/offline";
import { fetchProducts, stockStatus } from "@/lib/shop";
import { SignIn } from "@/components/SignIn";
import { ShopSetup } from "@/components/ShopSetup";
import { ShopBlocked } from "@/components/ShopBlocked";
import { BottomNav } from "@/components/BottomNav";
import { InstallBanner } from "@/components/InstallApp";

/**
 * Wraps every signed-in screen. It decides what to show:
 * not signed in -> sign-in form, no shop yet -> shop setup, otherwise the page with the bottom menu.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, role, loading, isPlatformAdmin, blocked } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const hasShop = Boolean(role);

  // Number on the bell icon: items that are low or out of stock
  const alerts = useQuery({
    queryKey: ["alert-count"],
    enabled: Boolean(session) && hasShop && !blocked,
    queryFn: async () => (await fetchProducts()).filter((p) => stockStatus(p) !== "ok").length,
    refetchInterval: 60_000,
  });

  // A platform admin does not need a shop. Without one, only the admin page and settings make sense.
  const adminOnly = !hasShop && isPlatformAdmin;
  useEffect(() => {
    if (!loading && session && adminOnly && pathname !== "/admin" && pathname !== "/settings") router.replace("/admin");
  }, [loading, session, adminOnly, pathname, router]);

  // Make the app installable and let it open offline
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  // Send sales that were rung up offline as soon as the connection is back
  useEffect(() => {
    if (!session) return;
    const run = async () => {
      if (!navigator.onLine || getQueue().length === 0) return;
      const result = await syncQueue();
      if (result.synced > 0) {
        toast.success(`${result.synced} offline sale${result.synced > 1 ? "s" : ""} synced`);
        void queryClient.invalidateQueries();
      }
      if (result.failed > 0) toast.error(`${result.failed} offline sale${result.failed > 1 ? "s" : ""} could not be synced`);
    };
    void run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [session, queryClient]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <SignIn />;
  if (blocked && !isPlatformAdmin) return <ShopBlocked />;
  if (!hasShop && !isPlatformAdmin) return <ShopSetup />;

  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-20">
      <InstallBanner />
      {children}
      <BottomNav alertCount={alerts.data ?? 0} adminOnly={adminOnly} />
    </div>
  );
}
