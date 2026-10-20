import { Link } from "@tanstack/react-router";
import { ScanLine, Package, BarChart3, Bell, Settings, Users } from "lucide-react";
import { usePrefs, type TKey } from "@/lib/prefs";

const items = [
  { to: "/", label: "sell", icon: ScanLine },
  { to: "/inventory", label: "inventory", icon: Package },
  { to: "/customers", label: "customers", icon: Users },
  { to: "/reports", label: "reports", icon: BarChart3 },
  { to: "/alerts", label: "alerts", icon: Bell },
  { to: "/settings", label: "settings", icon: Settings },
] as const satisfies ReadonlyArray<{ to: string; label: TKey; icon: unknown }>;

export function BottomNav({ alertCount = 0 }: { alertCount?: number }) {
  const { t } = usePrefs();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "text-primary" }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors"
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
        ))}
      </ul>
    </nav>
  );
}
