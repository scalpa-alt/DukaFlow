import { supabase } from "@/integrations/supabase/client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePref = "system" | "light" | "dark";
export type Lang = "en" | "sw";

const dict = {
  en: {
    sell: "Sell", inventory: "Inventory", reports: "Reports", alerts: "Alerts", settings: "Settings", customers: "Customers",
    outOfStock: "Out of stock", lowStock: "Low stock", left: "left", inStock: "In stock",
    scanSell: "Scan & Sell", scanHint: "Scan each item once. Scan again or type a number for more.",
    scanBarcode: "Scan barcode", stopCamera: "Stop camera", add: "Add", cart: "Cart", clear: "Clear",
    total: "Total", cash: "Cash", mpesa: "M-Pesa", credit: "Credit", paid: "Paid", pending: "Pending",
    unpaid: "Unpaid", shopClosed: "Shop is closed", theme: "Theme", language: "Language",
    system: "System", light: "Light", dark: "Dark", payment: "Payment", amountDue: "Amount due",
    nothingScanned: "Nothing scanned yet. Start scanning to build a sale.",
    expenses: "Expenses", save: "Save", rent: "Rent", restocking: "Restocking", transport: "Transport", wages: "Wages", utilities: "Utilities", other: "Other",
    revenue: "Revenue", netProfit: "Net profit", salesCount: "Sales", itemsSold: "Items sold", byMethod: "By payment method", bestSellers: "Best sellers",
    today: "Today", week: "Week", month: "Month", custom: "Custom", revenueByDay: "Revenue by day", noSales: "No sales in this period.",
    labels: "Barcode labels", signOut: "Sign out", completeSale: "Complete sale", creditUnpaid: "Credit (unpaid)", mpesaPending: "M-Pesa (pending)",
    lowStockAlerts: "Low stock alerts", restock: "Restock", ownerTools: "Owner tools",
    runningLow: "running low", wellStocked: "Everything is well stocked", wellStockedHint: "You'll see items here as soon as they drop to their alert level.", alertAt: "alert at", restockInInventory: "Restock in inventory",
  },
  sw: {
    sell: "Uza", inventory: "Bidhaa", reports: "Ripoti", alerts: "Arifa", settings: "Mipangilio", customers: "Wateja",
    outOfStock: "Bidhaa Imeisha", lowStock: "Bidhaa Inaisha", left: "zimebaki", inStock: "Zipo",
    scanSell: "Changanua na Uza", scanHint: "Changanua kila bidhaa mara moja. Changanua tena au andika idadi.",
    scanBarcode: "Changanua msimbo", stopCamera: "Zima kamera", add: "Ongeza", cart: "Kikapu", clear: "Futa",
    total: "Jumla", cash: "Pesa Taslimu", mpesa: "M-Pesa", credit: "Deni", paid: "Imelipwa", pending: "Inasubiri",
    unpaid: "Haijalipwa", shopClosed: "Duka Limefungwa", theme: "Mandhari", language: "Lugha",
    system: "Mfumo", light: "Mwanga", dark: "Giza", payment: "Malipo", amountDue: "Kiasi cha kulipa",
    nothingScanned: "Bado hakuna kilichochanganuliwa. Anza kuchanganua.",
    expenses: "Matumizi", save: "Hifadhi", rent: "Kodi", restocking: "Kununua bidhaa", transport: "Usafiri", wages: "Mishahara", utilities: "Huduma (maji, stima)", other: "Mengineyo",
    revenue: "Mapato", netProfit: "Faida halisi", salesCount: "Mauzo", itemsSold: "Bidhaa zilizouzwa", byMethod: "Kwa njia ya malipo", bestSellers: "Zinazouzwa zaidi",
    today: "Leo", week: "Wiki", month: "Mwezi", custom: "Chagua tarehe", revenueByDay: "Mapato kwa siku", noSales: "Hakuna mauzo katika kipindi hiki.",
    labels: "Lebo za msimbo", signOut: "Toka", completeSale: "Kamilisha mauzo", creditUnpaid: "Deni (halijalipwa)", mpesaPending: "M-Pesa (inasubiri)",
    lowStockAlerts: "Arifa za bidhaa", restock: "Ongeza bidhaa", ownerTools: "Zana za mmiliki",
    runningLow: "zinaisha", wellStocked: "Bidhaa zote zipo za kutosha", wellStockedHint: "Bidhaa zitaonekana hapa zikifika kiwango cha arifa.", alertAt: "arifa kwa", restockInInventory: "Ongeza katika Bidhaa",
  },
} as const;

export type TKey = keyof (typeof dict)["en"];

type Ctx = {
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  lang: Lang; setLang: (l: Lang) => void;
  t: (k: TKey) => string;
};
const PrefsContext = createContext<Ctx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    setThemeState((localStorage.getItem("dukaflow.theme") as ThemePref) || "system");
    setLangState((localStorage.getItem("dukaflow.lang") as Lang) || "en");
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // Language follows the signed-in account.
  useEffect(() => {
    const load = async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("profiles").select("lang").eq("id", u.user.id).maybeSingle();
      if (data?.lang === "en" || data?.lang === "sw") { setLangState(data.lang); localStorage.setItem("dukaflow.lang", data.lang); }
    };
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => { if (e === "SIGNED_IN") void load(); });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setTheme = (t: ThemePref) => { localStorage.setItem("dukaflow.theme", t); setThemeState(t); };
  const setLang = (l: Lang) => {
    localStorage.setItem("dukaflow.lang", l); setLangState(l);
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) void supabase.from("profiles").update({ lang: l }).eq("id", data.user.id);
    });
  };
  const t = useCallback((k: TKey) => dict[lang][k] ?? dict.en[k], [lang]);

  return (
    <PrefsContext.Provider value={{ theme, setTheme, lang, setLang, t }}>{children}</PrefsContext.Provider>
  );
}

export function usePrefs() {
  const c = useContext(PrefsContext);
  if (!c) throw new Error("usePrefs outside PrefsProvider");
  return c;
}
