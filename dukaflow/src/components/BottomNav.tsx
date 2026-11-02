"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanLine, Package, BarChart3, Bell, Settings, Users, ShieldCheck } from "lucide-react";
import { usePrefs, type TKey } from "@/lib/prefs";
import { cn } from "@/components/ui";

const shopTabs: { to: string; label: TKey; icon: typeof ScanLine }[] = [
  { to: "/", label: "sell", icon: ScanLine },
  { to: "/inventory", label: "inventory", icon: Package },
  { to: "/customers", label: "customers", icon: Users },
  { to: "/reports", label: "reports", icon: BarChart3 },
  { to: "/alerts", label: "alerts", icon: Bell },
  { to: "/settings", label: "settings", icon: Settings },
];

// A platform admin who has no shop of their own only needs these two.
const adminTabs: { to: string; label: TKey; icon: typeof ScanLine }[] = [
  { to: "/admin", label: "admin", icon: ShieldCheck },
  { to: "/settings", label: "settings", icon: Settings },
];

export function BottomNav({ alertCount = 0, adminOnly = false }: { alertCount?: number; adminOnly?: boolean }) {
  const { t } = usePrefs();
  const pathname = usePathname();
  const tabs = adminOnly ? adminTabs : shopTabs;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <li key={to} className="flex-1">
              <Link
                href={to}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {label === "alerts" && alertCount > 0 ? (
                    <span className="absolute -right-2 -top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  ) : null}
                </span>
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
