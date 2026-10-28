import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, CameraOff, Pencil, Plus, Printer, Search, Trash2, Wand2, X } from "lucide-react";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StockBadge } from "@/components/StockBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import {
  adjustStock, deleteProduct, fetchProducts, formatMoney, makeInternalBarcode, saveProduct, stockStatus,
  type Product,
} from "@/lib/shop";
import { loadStarterCatalog } from "@/lib/starter-catalog";

export const Route = createFileRoute("/inventory")({
  validateSearch: (s: Record<string, unknown>): { newBarcode?: string } => {
    const v = s["newBarcode"];
    return typeof v === "string" && v ? { newBarcode: v } : {};
  },
  head: () => ({
    meta: [
      { title: "Inventory — DukaFlow" },
      { name: "description", content: "Add, edit and restock the products in your shop." },
      { property: "og:title", content: "Inventory — DukaFlow" },
      { property: "og:description", content: "Add, edit and restock the products in your shop." },
    ],
  }),
  component: InventoryPage,
});

type Form = {
  id?: string; name: string; barcode: string; category: string;
  price: string; quantity: string; low_stock_threshold: string; barcode_internal: boolean;
};
const blank: Form = { name: "", barcode: "", category: "General", price: "", quantity: "0", low_stock_threshold: "5", barcode_internal: false };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// Code 128 encodes the stored barcode exactly, so a scanned label always finds its product.
async function printLabel(p: Product) {
  if (!p.barcode) return;
  const { default: JsBarcode } = await import("jsbarcode");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, p.barcode, { format: "CODE128", width: 2, height: 60, displayValue: true, fontSize: 14, margin: 4 });
  const w = window.open("", "_blank", "width=420,height=360");
  if (!w) { toast.error("Allow pop-ups to print the label"); return; }
  w.document.write(
    `<!doctype html><title>Label</title><body style="font-family:system-ui,sans-serif;text-align:center;margin:12px">` +
      `<div style="font-weight:700">${esc(p.name)}</div><div>KSh ${Number(p.price).toLocaleString("en-KE")}</div>${svg.outerHTML}` +
      `<script>window.onload=function(){window.print()}<\/script></body>`,
  );
  w.document.close();
}

function InventoryPage() {
  const { t } = usePrefs();
  const { isOwner } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(blank);
  const [scanning, setScanning] = useState(false);

  const { data: products, isLoading } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });

  // Arriving from the sell screen with an unknown barcode: open the form with it filled in.
  useEffect(() => {
    if (search.newBarcode && isOwner) {
      setForm({ ...blank, barcode: search.newBarcode });
      setOpen(true);
      void navigate({ to: "/inventory", search: {}, replace: true });
    }
  }, [search.newBarcode, isOwner, navigate]);

  const categories = useMemo(() => Array.from(new Set((products ?? []).map((p) => p.category))).sort(), [products]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (products ?? []).filter(
      (p) => (!cat || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle) || (p.barcode ?? "").includes(needle)),
    );
  }, [products, q, cat]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["products"] });
    void qc.invalidateQueries({ queryKey: ["alert-count"] });
  };

  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error("Enter a product name");
      const price = Number(form.price);
      if (!(price >= 0) || form.price === "") throw new Error("Enter a price");
      return saveProduct({
        ...(form.id ? { id: form.id } : {}),
        name: form.name.trim(), barcode: form.barcode, category: form.category,
        price, quantity: Math.max(0, Math.floor(Number(form.quantity) || 0)),
        low_stock_threshold: Math.max(0, Math.floor(Number(form.low_stock_threshold) || 0)),
        barcode_internal: form.barcode_internal,
      });
    },
    onSuccess: (p) => { toast.success(`${p.name} saved`); setForm(blank); setOpen(false); setScanning(false); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => { toast.success("Product deleted"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const starter = useMutation({
    mutationFn: () => loadStarterCatalog((products ?? []).map((p) => p.name)),
    onSuccess: (n) => { toast.success(n ? `${n} starter items added with 0 stock. Set their prices and quantities.` : "Starter items are already in your inventory"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = (p: Product) => {
    setForm({
      id: p.id, name: p.name, barcode: p.barcode ?? "", category: p.category, price: String(p.price),
      quantity: String(p.quantity), low_stock_threshold: String(p.low_stock_threshold), barcode_internal: Boolean(p.barcode_internal),
    });
    setOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const sel = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{t("inventory")}</h1>
          <p className="text-sm text-muted-foreground">{(products ?? []).length} products</p>
        </div>
        {isOwner ? (
          <Button size="sm" onClick={() => { setForm(blank); setOpen((v) => !v); }}>
            {open ? <X className="mr-1 size-4" /> : <Plus className="mr-1 size-4" />}{open ? "Close" : "Add product"}
          </Button>
        ) : null}
      </header>

      {isOwner && open ? (
        <form className="space-y-2 rounded-2xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <p className="font-semibold">{form.id ? "Edit product" : "New product"}</p>
          <Input required placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            <Input placeholder="Barcode" inputMode="numeric" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value, barcode_internal: false })} />
            <Button type="button" variant="outline" size="icon" aria-label="Scan barcode" onClick={() => setScanning((v) => !v)}>
              {scanning ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label="Generate shop barcode" title="Generate a barcode for items without one"
              onClick={() => setForm({ ...form, barcode: makeInternalBarcode(), barcode_internal: true })}>
              <Wand2 className="size-4" />
            </Button>
          </div>
          {scanning ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <BarcodeScanner active={scanning} onDetected={(code) => { setForm((f) => ({ ...f, barcode: code, barcode_internal: false })); setScanning(false); }} />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Category" list="categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <Input required placeholder="Price (KSh)" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <label className="text-xs text-muted-foreground">Quantity in stock
              <Input inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
            <label className="text-xs text-muted-foreground">Alert when stock is at or below
              <Input inputMode="numeric" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} /></label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>{t("save")}</Button>
            <Button type="button" variant="ghost" onClick={() => { setForm(blank); setOpen(false); setScanning(false); }}>Cancel</Button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select aria-label="Category" className={`${sel} w-40`} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {isLoading ? <p className="py-6 text-center text-muted-foreground">Loading…</p> : null}
      {!isLoading && (products ?? []).length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="font-medium">No products yet</p>
          <p className="text-sm text-muted-foreground">{isOwner ? "Add your first product, or load a list of common shop items to start from." : "The owner hasn't added any products yet."}</p>
          {isOwner ? <Button className="mt-3" variant="secondary" disabled={starter.isPending} onClick={() => starter.mutate()}>Load starter items</Button> : null}
        </div>
      ) : null}

      <ul className="space-y-3">
        {list.map((p) => (
          <li key={p.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-display text-base font-semibold">{p.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(p.price)} · {p.category}{p.barcode ? ` · ${p.barcode}` : ""}
                </p>
              </div>
              <StockBadge product={p} />
            </div>
            {isOwner ? (
              <div className="mt-3 space-y-2">
                <StockAdjust product={p} onDone={refresh} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => edit(p)}><Pencil className="mr-1 size-4" />Edit</Button>
                  {p.barcode && p.barcode_internal ? (
                    <Button size="sm" variant="outline" onClick={() => void printLabel(p)}><Printer className="mr-1 size-4" />{t("labels")}</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={del.isPending}
                    onClick={() => { if (window.confirm(`Delete ${p.name}? Past sales keep their records.`)) del.mutate(p.id); }}>
                    <Trash2 className="mr-1 size-4" />Delete
                  </Button>
                </div>
              </div>
            ) : stockStatus(p) !== "ok" ? null : null}
          </li>
        ))}
        {!isLoading && (products ?? []).length > 0 && list.length === 0 ? <li className="py-6 text-center text-muted-foreground">No products match your search.</li> : null}
      </ul>

      {isOwner && (products ?? []).length > 0 ? (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled={starter.isPending} onClick={() => starter.mutate()}>
          Add common shop items I don't have yet
        </Button>
      ) : null}
    </div>
  );
}

// Add or remove stock; every change is logged in the stock history.
function StockAdjust({ product, onDone }: { product: Product; onDone: () => void }) {
  const [n, setN] = useState("");
  const m = useMutation({
    mutationFn: () => adjustStock(product, Math.trunc(Number(n))),
    onSuccess: (p) => { toast.success(`${p.name}: ${p.quantity} in stock`); setN(""); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const change = Math.trunc(Number(n));
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (change !== 0 && Number.isFinite(change)) m.mutate(); }}>
      <Input type="number" inputMode="numeric" placeholder="+10 or -2" value={n} onChange={(e) => setN(e.target.value)} className="h-9 w-28" />
      <Button size="sm" type="submit" variant="secondary" disabled={m.isPending || !Number.isFinite(change) || change === 0}>Adjust stock</Button>
    </form>
  );
}
