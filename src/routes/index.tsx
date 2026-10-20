import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { sendStkPush } from "@/lib/mpesa.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, CameraOff, Minus, Plus, Search, Trash2, X } from "lucide-react";

import { usePrefs } from "@/lib/prefs";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StockBadge } from "@/components/StockBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkout,
  fetchCustomers,
  saveCustomer,
  fetchProductByBarcode,
  fetchProducts,
  formatMoney,
  stockStatus,
  type CartLine,
  type Product,
} from "@/lib/shop";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scan & Sell — DukaFlow" },
      {
        name: "description",
        content: "Scan barcodes to build a cart, adjust quantities and check out in seconds.",
      },
      { property: "og:title", content: "Scan & Sell — DukaFlow" },
      {
        property: "og:description",
        content: "Scan barcodes to build a cart, adjust quantities and check out in seconds.",
      },
    ],
  }),
  component: SellPage,
});

const CART_KEY = "dukaflow.cart";

function SellPage() {
  const navigate = useNavigate();
  const { t } = usePrefs();
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastScan, setLastScan] = useState<Product | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);

  const { data: products } = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: fetchCustomers });
  const stk = useServerFn(sendStkPush);
  const [method, setMethod] = useState<"cash" | "mpesa" | "credit">("cash");
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(CART_KEY);
    if (saved) {
      try {
        setCart(JSON.parse(saved) as CartLine[]);
      } catch {
        /* ignore malformed cart */
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const addProduct = useCallback((product: Product) => {
    setLastScan(product);
    setUnknownBarcode(null);
    if (stockStatus(product) === "out") {
      toast.error(`${product.name} is out of stock`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product_id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product_id === product.id
            ? { ...l, quantity: Math.min(l.quantity + 1, product.quantity) }
            : l,
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
          stock: product.quantity,
        },
      ];
    });
    toast.success(`${product.name} added · ${formatMoney(product.price)}`);
  }, []);

  const handleBarcode = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const product = await fetchProductByBarcode(trimmed);
      if (!product) {
        setLastScan(null);
        setUnknownBarcode(trimmed);
        toast.warning(`Barcode ${trimmed} is not in your inventory yet`);
        return;
      }
      addProduct(product);
    },
    [addProduct],
  );

  const total = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      let cid: string | null = null;
      if (method === "credit") {
        if (customerId) cid = customerId;
        else {
          await saveCustomer({ name: newName, phone: newPhone, credit_limit: 0 });
          const list = await fetchCustomers();
          cid = list.find((c) => c.name === newName.trim() && (c.phone ?? "") === newPhone.trim())?.id ?? null;
          if (!cid) throw new Error("Could not add customer");
        }
      }
      const saleId = await checkout(cart, method, cid);
      if (saleId && method === "mpesa" && phone.trim()) {
        const r = await stk({ data: { saleId, phone: phone.trim() } });
        (r.ok ? toast.success : toast.error)(r.message);
      }
      return saleId;
    },
    onSuccess: (saleId) => {
      setNewName(""); setNewPhone(""); setCustomerId(""); setPhone("");
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (!saleId) { setCart([]); setLastScan(null); toast.success("No internet: sale saved on this phone and will sync later"); return; }
      setCart([]);
      setLastScan(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      const lowNow = (products ?? []).filter((p) => {
        const sold = cart.find((l) => l.product_id === p.id);
        if (!sold) return false;
        return p.quantity - sold.quantity <= p.low_stock_threshold;
      });
      lowNow.forEach((p) => {
        const sold = cart.find((l) => l.product_id === p.id)!;
        toast.warning(`${p.name} is running low: ${Math.max(0, p.quantity - sold.quantity)} left`);
      });
      navigate({ to: "/payments", search: { sale: saleId } });
    },
    onError: (err: Error) => toast.error(err.message || "Checkout failed"),
  });

  const suggestions =
    manual.length > 1
      ? (products ?? [])
          .filter(
            (p) =>
              p.name.toLowerCase().includes(manual.toLowerCase()) ||
              (p.barcode ?? "").includes(manual),
          )
          .slice(0, 5)
      : [];

  return (
    <div className="px-4 pb-6 pt-5">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("scanSell")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("scanHint")}
        </p>
      </header>

      <div className="mb-3 flex gap-2">
        <Button
          className="flex-1"
          size="lg"
          variant={scanning ? "secondary" : "default"}
          onClick={() => setScanning((s) => !s)}
        >
          {scanning ? <CameraOff className="mr-2 size-4" /> : <Camera className="mr-2 size-4" />}
          {scanning ? t("stopCamera") : t("scanBarcode")}
        </Button>
      </div>

      <div className="mb-4">
        <BarcodeScanner active={scanning} onDetected={(code) => void handleBarcode(code)} />
      </div>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleBarcode(manual);
          setManual("");
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Type barcode or item name"
            className="pl-9"
            inputMode="search"
          />
        </div>
        <Button type="submit" variant="secondary">
          {t("add")}
        </Button>
      </form>

      {suggestions.length > 0 ? (
        <ul className="mb-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {suggestions.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-accent/60"
                onClick={() => {
                  addProduct(p);
                  setManual("");
                }}
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-muted-foreground">{formatMoney(p.price)}</span>
                </span>
                <StockBadge product={p} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {unknownBarcode ? (
        <div className="mb-4 rounded-xl border border-warning/50 bg-warning/10 p-4">
          <p className="text-sm font-semibold">Unknown barcode {unknownBarcode}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This item isn't in your inventory yet.
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() =>
              navigate({ to: "/inventory", search: { newBarcode: unknownBarcode ?? "" } })
            }
          >
            Add it as a new product
          </Button>
        </div>
      ) : null}

      {lastScan ? (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last scanned</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg font-semibold">{lastScan.name}</p>
              <p className="text-sm text-muted-foreground">{formatMoney(lastScan.price)}</p>
            </div>
            <StockBadge product={lastScan} />
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{t("cart")} ({itemCount})</h2>
          {cart.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setCart([])}>
              <X className="mr-1 size-4" /> {t("clear")}
            </Button>
          ) : null}
        </div>

        {cart.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("nothingScanned")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {cart.map((line) => (
              <li key={line.product_id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{line.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatMoney(line.price)} · {formatMoney(line.price * line.quantity)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8"
                    onClick={() =>
                      setCart((prev) =>
                        prev
                          .map((l) =>
                            l.product_id === line.product_id
                              ? { ...l, quantity: l.quantity - 1 }
                              : l,
                          )
                          .filter((l) => l.quantity > 0),
                      )
                    }
                  >
                    <Minus className="size-4" />
                  </Button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={line.stock}
                    aria-label={`Quantity of ${line.name}`}
                    value={line.quantity}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(line.stock, Math.floor(Number(e.target.value) || 1)));
                      setCart((prev) => prev.map((l) => (l.product_id === line.product_id ? { ...l, quantity: n } : l)));
                    }}
                    className="h-8 w-12 rounded-md border border-input bg-background text-center font-semibold"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-8"
                    onClick={() =>
                      setCart((prev) =>
                        prev.map((l) =>
                          l.product_id === line.product_id
                            ? { ...l, quantity: Math.min(l.quantity + 1, l.stock) }
                            : l,
                        ),
                      )
                    }
                  >
                    <Plus className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive"
                    onClick={() =>
                      setCart((prev) => prev.filter((l) => l.product_id !== line.product_id))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">{t("total")}</span>
          <span className="font-display text-2xl font-bold">{formatMoney(total)}</span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["cash", "mpesa", "credit"] as const).map((m) => (
            <Button key={m} size="lg" variant={method === m ? "default" : "outline"} onClick={() => setMethod(m)}>
              {t(m)}
            </Button>
          ))}
        </div>

        {method === "mpesa" ? (
          <Input className="mt-3" inputMode="tel" placeholder="Customer phone for M-Pesa prompt (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        ) : null}

        {method === "credit" ? (
          <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
            <select aria-label="Customer" className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose customer…</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""} — owes {formatMoney(c.balance)}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Or add a new customer:</p>
            <div className="flex gap-2">
              <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input placeholder="Phone" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            </div>
          </div>
        ) : null}

        <Button
          className="mt-3 w-full"
          size="lg"
          disabled={cart.length === 0 || checkoutMutation.isPending || (method === "credit" && !customerId && !newName.trim())}
          onClick={() => checkoutMutation.mutate()}
        >
          {checkoutMutation.isPending ? "…" : `${t("completeSale")} · ${formatMoney(total)}`}
        </Button>
      </section>
    </div>
  );
}
