"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, LogOut, ReceiptText, ShieldCheck } from "lucide-react";
import { OwnerSettings } from "@/components/OwnerSettings";
import { Button, cn } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs, type Lang, type ThemePref } from "@/lib/prefs";

export default function SettingsPage() {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const { isOwner, isPlatformAdmin, session, signOut } = useAuth();

  const themes: ThemePref[] = ["system", "light", "dark"];
  const langs: [Lang, string][] = [
    ["en", "English"],
    ["sw", "Kiswahili"],
  ];

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("settings")}</h1>
        {session?.user.email ? <p className="text-sm text-muted-foreground">{session.user.email}</p> : null}
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("language")}</p>
          <Segmented options={langs} value={lang} onChange={setLang} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("theme")}</p>
          <Segmented options={themes.map((k) => [k, t(k)] as [ThemePref, string])} value={theme} onChange={setTheme} />
        </div>
      </section>

      {isPlatformAdmin ? (
        <NavRow href="/admin" icon={<ShieldCheck className="size-5 text-primary" />} label="Platform admin" hint="Every shop, owner and seller" />
      ) : null}

      {isOwner ? (
        <>
          <h2 className="pt-1 font-display text-lg font-semibold">{t("ownerTools")}</h2>
          <NavRow href="/expenses" icon={<ReceiptText className="size-5 text-primary" />} label={t("expenses")} />
          <OwnerSettings />
        </>
      ) : null}

      <Button variant="outline" className="w-full" onClick={() => void signOut()}>
        <LogOut className="mr-2 size-4" />
        {t("signOut")}
      </Button>
    </div>
  );
}

function NavRow({ href, icon, label, hint }: { href: string; icon: ReactNode; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-muted p-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
            value === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
