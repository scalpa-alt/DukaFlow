import { createFileRoute, Link } from "@tanstack/react-router";
import { LogOut, Receipt, ShieldCheck } from "lucide-react";

import { OwnerSettings } from "@/components/OwnerSettings";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { usePrefs, type Lang, type ThemePref } from "@/lib/prefs";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — DukaFlow" },
      { name: "description", content: "Shop hours, staff, language and theme." },
      { property: "og:title", content: "Settings — DukaFlow" },
      { property: "og:description", content: "Shop hours, staff, language and theme." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, theme, setTheme, lang, setLang } = usePrefs();
  const { session, isOwner, isPlatformAdmin, signOut } = useAuth();
  const sel = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("settings")}</h1>
        <p className="text-sm text-muted-foreground">{session?.user.email}</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <label className="block text-sm font-medium">{t("language")}
          <select className={`${sel} mt-1`} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </label>
        <label className="block text-sm font-medium">{t("theme")}
          <select className={`${sel} mt-1`} value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)}>
            <option value="system">{t("system")}</option>
            <option value="light">{t("light")}</option>
            <option value="dark">{t("dark")}</option>
          </select>
        </label>
      </section>

      {isOwner ? (
        <>
          <h2 className="pt-1 font-display text-lg font-semibold">{t("ownerTools")}</h2>
          <Button asChild variant="outline" className="w-full justify-start">
            <Link to="/expenses"><Receipt className="mr-2 size-4" />{t("expenses")}</Link>
          </Button>
          <OwnerSettings />
        </>
      ) : null}

      {isPlatformAdmin ? (
        <Button asChild variant="outline" className="w-full justify-start">
          <Link to="/admin"><ShieldCheck className="mr-2 size-4" />Platform admin</Link>
        </Button>
      ) : null}

      <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
        <LogOut className="mr-2 size-4" />{t("signOut")}
      </Button>
    </div>
  );
}
