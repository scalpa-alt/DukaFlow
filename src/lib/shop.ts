import { supabase } from "@/integrations/supabase/client";
import { enqueue, isNetworkError } from "@/lib/offline";

export type Product = {
  id: string;
  barcode: string | null;
  name: string;
  price: number;
  quantity: number;
  category: string;
  low_stock_threshold: number;
  barcode_internal?: boolean;
  created_at: string;
  updated_at: string;
};

export type Sale = {
  id: string;
  total: number;
  item_count: number;
  payment_method: string;
  payment_status: string;
  note: string | null;
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  barcode: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  created_at: string;
};

export type MpesaPayment = {
  id: string;
  transaction_id: string;
  payer_name: string | null;
  payer_phone: string | null;
  amount: number;
  paid_at: string;
  matched_sale_id: string | null;
  created_at: string;
};

export type CartLine = {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  stock: number;
};

export type StockStatus = "out" | "low" | "ok";

export function stockStatus(p: Pick<Product, "quantity" | "low_stock_threshold">): StockStatus {
  if (p.quantity <= 0) return "out";
  if (p.quantity <= p.low_stock_threshold) return "low";
  return "ok";
}

export function formatMoney(value: number): string {
  return `KSh ${Number(value ?? 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/* ---------- data access ---------- */

const PRODUCTS_KEY = "dukaflow.products";

function cachedProducts(): Product[] {
  try { return JSON.parse(localStorage.getItem(PRODUCTS_KEY) ?? "[]") as Product[]; } catch { return []; }
}

export async function fetchProducts(): Promise<Product[]> {
  try {
    const { data, error } = await supabase.from("products").select("*").order("name", { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as Product[];
    if (typeof window !== "undefined") localStorage.setItem(PRODUCTS_KEY, JSON.stringify(list));
    return list;
  } catch (e) {
    if (typeof window !== "undefined" && isNetworkError(e)) return cachedProducts();
    throw e;
  }
}

export async function fetchProductByBarcode(barcode: string): Promise<Product | null> {
  try {
    const { data, error } = await supabase.from("products").select("*").eq("barcode", barcode).maybeSingle();
    if (error) throw error;
    return (data as Product | null) ?? null;
  } catch (e) {
    if (isNetworkError(e)) return cachedProducts().find((p) => p.barcode === barcode) ?? null;
    throw e;
  }
}

export async function saveProduct(input: Partial<Product>): Promise<Product> {
  const payload = {
    barcode: input.barcode?.trim() ? input.barcode.trim() : null,
    name: input.name ?? "",
    price: Number(input.price ?? 0),
    quantity: Number(input.quantity ?? 0),
    category: input.category?.trim() || "General",
    low_stock_threshold: Number(input.low_stock_threshold ?? 5),
    barcode_internal: Boolean(input.barcode_internal),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("products")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as Product;
  }

  const { data, error } = await supabase.from("products").insert(payload).select("*").single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

export async function adjustStock(product: Product, change: number): Promise<Product> {
  const next = Math.max(0, product.quantity + change);
  const { data, error } = await supabase
    .from("products")
    .update({ quantity: next, updated_at: new Date().toISOString() })
    .eq("id", product.id)
    .select("*")
    .single();
  if (error) throw error;
  await supabase
    .from("stock_movements")
    .insert({ product_id: product.id, change, resulting_quantity: next, reason: "manual" });
  return data as Product;
}

export type PayMethod = "cash" | "mpesa" | "credit";

/** Returns the sale id, or null when the sale was saved offline to sync later. */
export async function checkout(
  lines: CartLine[],
  paymentMethod: PayMethod,
  customerId: string | null = null,
): Promise<string | null> {
  const client_ref = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const queueIt = () => {
    enqueue({
      client_ref, created_at, method: paymentMethod, customer_id: customerId,
      items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, name: l.name, price: l.price })),
      total: lines.reduce((s, l) => s + l.price * l.quantity, 0),
    });
    // Reduce the stock we keep on the phone so the next sale sees it.
    const cache = cachedProducts().map((p) => {
      const l = lines.find((x) => x.product_id === p.id);
      return l ? { ...p, quantity: Math.max(0, p.quantity - l.quantity) } : p;
    });
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(cache));
    return null;
  };
  if (!navigator.onLine) return queueIt();
  try {
    const { data, error } = await supabase.rpc("checkout_sale_v2", {
      p_items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
      p_payment_method: paymentMethod,
      ...(customerId ? { p_customer_id: customerId } : {}),
      p_client_ref: client_ref,
      p_created_at: created_at,
    });
    if (error) throw error;
    return data as unknown as string;
  } catch (e) {
    if (isNetworkError(e)) return queueIt();
    throw e;
  }
}

/* ---------- customers & credit ---------- */

export type Customer = { id: string; name: string; phone: string | null; credit_limit: number; created_at: string };
export type CustomerWithBalance = Customer & { balance: number; oldest: string | null };

export async function fetchCustomers(): Promise<CustomerWithBalance[]> {
  const [{ data: cs, error: e1 }, { data: debts, error: e2 }] = await Promise.all([
    supabase.from("customers").select("*").order("name"),
    supabase.from("sales").select("customer_id,total,amount_paid,created_at")
      .eq("payment_method", "credit").in("payment_status", ["unpaid", "partial"]),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return ((cs ?? []) as Customer[]).map((c) => {
    const mine = (debts ?? []).filter((d) => d.customer_id === c.id);
    return {
      ...c,
      balance: mine.reduce((s, d) => s + Number(d.total) - Number(d.amount_paid), 0),
      oldest: mine.map((d) => d.created_at).sort()[0] ?? null,
    };
  });
}

export async function saveCustomer(c: { id?: string; name: string; phone: string; credit_limit: number }) {
  const payload = { name: c.name.trim(), phone: c.phone.trim() || null, credit_limit: Number(c.credit_limit) || 0 };
  const { error } = c.id
    ? await supabase.from("customers").update(payload).eq("id", c.id)
    : await supabase.from("customers").insert(payload);
  if (error) throw error;
}

export async function recordRepayment(customerId: string, amount: number, method: "cash" | "mpesa") {
  const { data, error } = await supabase.rpc("record_repayment", { p_customer_id: customerId, p_amount: amount, p_method: method });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function fetchStockConflicts(): Promise<Sale[]> {
  const { data, error } = await supabase.from("sales").select("*").eq("stock_conflict", true)
    .order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as Sale[];
}

export async function fetchSale(id: string): Promise<{ sale: Sale; items: SaleItem[] } | null> {
  const [{ data: sale, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase.from("sales").select("*").eq("id", id).maybeSingle(),
    supabase.from("sale_items").select("*").eq("sale_id", id),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (!sale) return null;
  return { sale: sale as Sale, items: (items ?? []) as SaleItem[] };
}

export async function fetchSalesRange(from: Date, to: Date) {
  const [{ data: sales, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase
      .from("sales")
      .select("*")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("sale_items")
      .select("*")
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString()),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return { sales: (sales ?? []) as Sale[], items: (items ?? []) as SaleItem[] };
}

export async function fetchMpesaPayments(): Promise<MpesaPayment[]> {
  const { data, error } = await supabase
    .from("mpesa_payments")
    .select("*")
    .order("paid_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as MpesaPayment[];
}

export async function matchPaymentToSale(paymentId: string, saleId: string): Promise<void> {
  const { error } = await supabase
    .from("mpesa_payments")
    .update({ matched_sale_id: saleId })
    .eq("id", paymentId);
  if (error) throw error;
  const { error: e2 } = await supabase
    .from("sales")
    .update({ payment_status: "paid", payment_method: "mpesa" })
    .eq("id", saleId);
  if (e2) throw e2;
}

export async function fetchPendingSales(): Promise<Sale[]> {
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .eq("payment_status", "pending")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as Sale[];
}

export type ExpenseCategory = "rent" | "restocking" | "transport" | "wages" | "utilities" | "other";
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ["rent", "restocking", "transport", "wages", "utilities", "other"];
export type Expense = { id: string; category: ExpenseCategory; description: string; amount: number; date: string; created_at: string };

export async function fetchExpenses(from: string, to: string): Promise<Expense[]> {
  const { data, error } = await supabase.from("expenses").select("*").gte("date", from).lte("date", to).order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Expense[];
}
export async function saveExpense(e: { id?: string; category: ExpenseCategory; description: string; amount: number; date: string }) {
  const row = { category: e.category, description: e.description.trim(), amount: e.amount, date: e.date };
  const { error } = e.id ? await supabase.from("expenses").update(row).eq("id", e.id) : await supabase.from("expenses").insert(row);
  if (error) throw error;
}
export async function deleteExpense(id: string) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}
/** Internal EAN-style code starting with 2 (reserved for in-store use). */
export function makeInternalBarcode(): string {
  let s = "2";
  for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10);
  return s;
}
