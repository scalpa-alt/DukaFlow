import { useEffect, type ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, Link } from "@tanstack/react-router";
import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PrefsProvider } from "@/lib/prefs";
import { getQueue, syncQueue } from "@/lib/offline";
import { fetchProducts, stockStatus } from "@/lib/shop";
import { SignIn } from "@/components/SignIn";
import { ShopSetup } from "@/components/ShopGate";
import { BottomNav } from "@/components/BottomNav";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "DukaFlow — Shop stock & sales" },
      { name: "description", content: "Scan barcodes, sell fast, track stock and see daily sales for your shop." },
      { name: "theme-color", content: "#0f766e" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-2xl font-bold">Page not found</h1>
      <Link to="/" className="text-primary underline">Go to the sell screen</Link>
    </div>
  ),
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <AuthProvider>
          <Gate />
          <Toaster position="top-center" />
        </AuthProvider>
      </PrefsProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const { session, role, loading, isPlatformAdmin } = useAuth();
  const qc = useQueryClient();

  // Low-stock count for the bell badge in the bottom nav.
  const alerts = useQuery({
    queryKey: ["alert-count"],
    enabled: !!session && !!role,
    queryFn: async () => (await fetchProducts()).filter((p) => stockStatus(p) !== "ok").length,
    refetchInterval: 60_000,
  });

  // Installable app: cache the app shell so it opens offline.
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  // Push sales that were rung up offline as soon as the connection is back.
  useEffect(() => {
    if (!session) return;
    const run = async () => {
      if (!navigator.onLine || getQueue().length === 0) return;
      const r = await syncQueue();
      if (r.synced > 0) { toast.success(`${r.synced} offline sale${r.synced > 1 ? "s" : ""} synced`); void qc.invalidateQueries(); }
      if (r.failed > 0) toast.error(`${r.failed} offline sale${r.failed > 1 ? "s" : ""} could not be synced`);
    };
    void run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [session, qc]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (!session) return <SignIn />;
  // Signed in but not part of a shop yet: create one or join with a code. The platform admin skips this.
  if (!role && !isPlatformAdmin) return <ShopSetup />;

  return (
    <div className="mx-auto min-h-screen max-w-2xl pb-20">
      <Outlet />
      <BottomNav alertCount={alerts.data ?? 0} />
    </div>
  );
}
