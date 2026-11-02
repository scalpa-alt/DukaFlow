import { supabase } from "@/lib/supabase";
import { enqueue, isNetworkError } from "@/lib/offline";

/* ---------- types ---------- */

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
  amount_paid?: number;
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

export type Customer = { id: string; name: string; phone: string | null; credit_limit: number; created_at: string };
export type CustomerWithBalance = Customer & { balance: number; oldest: string | null };

export type PayMethod = "cash" | "mpesa" | "credit";
export type StockStatus = "out" | "low" | "ok";

export type ExpenseCategory = "rent" | "restocking" | "transport" | "wages" | "utilities" | "other";
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ["rent", "restocking", "transport", "wages", "utilities", "other"];
export type Expense = {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  created_at: string;
};

/* ---------- small helpers ---------- */

export function stockStatus(p: Pick<Product, "quantity" | "low_stock_threshold">): StockStatus {
  if (p.quantity <= 0) return "out";
  if (p.quantity <= p.low_stock_threshold) return "low";
  return "ok";
}

export function formatMoney(value: number): string {
  return `KSh ${Number(value ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Internal EAN-style code starting with 2 (reserved for in-store use). */
export function makeInternalBarcode(): string {
  let code = "2";
  for (let i = 0; i < 11; i++) code += Math.floor(Math.random() * 10);
  return code;
}

/* ---------- products ---------- */

// The product list is also kept on the phone so selling still works with no internet.
const PRODUCTS_KEY = "dukaflow.products";

function cachedProducts(): Product[] {
  try {
    return JSON.parse(localStorage.getItem(PRODUCTS_KEY) ?? "[]") as Product[];
  } catch {
    return [];
  }
}

export async function fetchProducts(): Promise<Product[]> {
  try {
    const { data, error } = await supabase.from("products").select("*").order("name", { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as Product[];
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(list));
    return list;
  } catch (e) {
    if (isNetworkError(e)) return cachedProducts();
    throw e;
  }
}

export async function fetchProductByBarcode(barcode: string): Promise<Product | null> {
  try {
    const { data, error } = await supabase.from("products").select("*").eq("barcode", barcode).limit(1).maybeSingle();
    if (error) throw error;
    return (data as Product | null) ?? null;
  } catch (e) {
    if (isNetworkError(e)) return cachedProducts().find((p) => p.barcode === barcode) ?? null;
    throw e;
  }
}

export async function saveProduct(input: Partial<Product>): Promise<Product> {
  const row = {
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
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as Product;
  }

  const { data, error } = await supabase.from("products").insert(row).select("*").single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

/** Add (positive) or remove (negative) stock, and write it to the stock history. */
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

/* ---------- checkout ---------- */

/** Returns the sale id, or null when the sale was saved on the phone to sync later. */
export async function checkout(lines: CartLine[], method: PayMethod, customerId: string | null = null): Promise<string | null> {
  const clientRef = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const saveOffline = () => {
    enqueue({
      client_ref: clientRef,
      created_at: createdAt,
      method,
      customer_id: customerId,
      items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, name: l.name, price: l.price })),
      total: lines.reduce((sum, l) => sum + l.price * l.quantity, 0),
    });
    // Lower the stock we keep on the phone, so the next sale sees the right numbers.
    const updated = cachedProducts().map((p) => {
      const sold = lines.find((l) => l.product_id === p.id);
      return sold ? { ...p, quantity: Math.max(0, p.quantity - sold.quantity) } : p;
    });
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(updated));
    return null;
  };

  if (!navigator.onLine) return saveOffline();

  try {
    const { data, error } = await supabase.rpc("checkout_sale_v2", {
      p_items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
      p_payment_method: method,
      ...(customerId ? { p_customer_id: customerId } : {}),
      p_client_ref: clientRef,
      p_created_at: createdAt,
    });
    if (error) throw error;
    return data as string;
  } catch (e) {
    if (isNetworkError(e)) return saveOffline();
    throw e;
  }
}

/* ---------- customers and credit ---------- */

export async function fetchCustomers(): Promise<CustomerWithBalance[]> {
  const [customersRes, debtsRes] = await Promise.all([
    supabase.from("customers").select("*").order("name"),
    supabase
      .from("sales")
      .select("customer_id,total,amount_paid,created_at")
      .eq("payment_method", "credit")
      .in("payment_status", ["unpaid", "partial"]),
  ]);
  if (customersRes.error) throw customersRes.error;
  if (debtsRes.error) throw debtsRes.error;

  const debts = debtsRes.data ?? [];
  return ((customersRes.data ?? []) as Customer[]).map((c) => {
    const mine = debts.filter((d) => d.customer_id === c.id);
    return {
      ...c,
      balance: mine.reduce((sum, d) => sum + Number(d.total) - Number(d.amount_paid), 0),
      oldest: mine.map((d) => d.created_at as string).sort()[0] ?? null,
    };
  });
}

export async function saveCustomer(c: { id?: string; name: string; phone: string; credit_limit: number }) {
  const row = { name: c.name.trim(), phone: c.phone.trim() || null, credit_limit: Number(c.credit_limit) || 0 };
  const { error } = c.id
    ? await supabase.from("customers").update(row).eq("id", c.id)
    : await supabase.from("customers").insert(row);
  if (error) throw error;
}

/** Records a repayment and clears the oldest debt first. Returns any amount left over. */
export async function recordRepayment(customerId: string, amount: number, method: "cash" | "mpesa") {
  const { data, error } = await supabase.rpc("record_repayment", {
    p_customer_id: customerId,
    p_amount: amount,
    p_method: method,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/* ---------- sales and reports ---------- */

export async function fetchSale(id: string): Promise<{ sale: Sale; items: SaleItem[] } | null> {
  const [saleRes, itemsRes] = await Promise.all([
    supabase.from("sales").select("*").eq("id", id).maybeSingle(),
    supabase.from("sale_items").select("*").eq("sale_id", id),
  ]);
  if (saleRes.error) throw saleRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (!saleRes.data) return null;
  return { sale: saleRes.data as Sale, items: (itemsRes.data ?? []) as SaleItem[] };
}

export async function fetchSalesRange(from: Date, to: Date) {
  const [salesRes, itemsRes] = await Promise.all([
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
  if (salesRes.error) throw salesRes.error;
  if (itemsRes.error) throw itemsRes.error;
  return { sales: (salesRes.data ?? []) as Sale[], items: (itemsRes.data ?? []) as SaleItem[] };
}

/* ---------- M-Pesa payments ---------- */

export async function fetchMpesaPayments(): Promise<MpesaPayment[]> {
  const { data, error } = await supabase.from("mpesa_payments").select("*").order("paid_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as MpesaPayment[];
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

export async function matchPaymentToSale(paymentId: string, saleId: string): Promise<void> {
  const { error } = await supabase.from("mpesa_payments").update({ matched_sale_id: saleId }).eq("id", paymentId);
  if (error) throw error;
  const { error: saleError } = await supabase
    .from("sales")
    .update({ payment_status: "paid", payment_method: "mpesa" })
    .eq("id", saleId);
  if (saleError) throw saleError;
}

/* ---------- expenses ---------- */

export async function fetchExpenses(from: string, to: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Expense[];
}

export async function saveExpense(e: { id?: string; category: ExpenseCategory; description: string; amount: number; date: string }) {
  const row = { category: e.category, description: e.description.trim(), amount: e.amount, date: e.date };
  const { error } = e.id
    ? await supabase.from("expenses").update(row).eq("id", e.id)
    : await supabase.from("expenses").insert(row);
  if (error) throw error;
}

export async function deleteExpense(id: string) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- shop details and logo (used on receipts) ---------- */

export type ShopProfile = {
  id: number; // the shop_settings row
  shop_id: string;
  shop_name: string;
  owner_name: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  logo_url: string | null;
  receipt_footer: string;
};

const PROFILE_COLUMNS = "id,shop_id,shop_name,owner_name,contact_phone,contact_email,address,logo_url,receipt_footer";

/** The signed-in person's own shop details. Sellers can read them too, for receipts. */
export async function fetchShopProfile(): Promise<ShopProfile | null> {
  const { data: shopId } = await supabase.rpc("current_shop_id");
  if (!shopId) return null;
  const { data, error } = await supabase.from("shop_settings").select(PROFILE_COLUMNS).eq("shop_id", shopId).maybeSingle();
  if (error) throw error;
  return (data as ShopProfile | null) ?? null;
}

export type ShopProfileInput = Pick<ShopProfile, "owner_name" | "contact_phone" | "contact_email" | "address" | "receipt_footer">;

export async function saveShopProfile(settingsId: number, input: ShopProfileInput) {
  const { error } = await supabase
    .from("shop_settings")
    .update({
      owner_name: input.owner_name.trim(),
      contact_phone: input.contact_phone.trim(),
      contact_email: input.contact_email.trim(),
      address: input.address.trim(),
      receipt_footer: input.receipt_footer.trim(),
    })
    .eq("id", settingsId);
  if (error) throw error;
}

/** Shrinks a picked photo to at most 512 px so receipts stay light and quick to load. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize pictures");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG keeps transparent logos transparent
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not prepare the picture");
  return blob;
}

/** Uploads a new logo into this shop's own folder and saves its address on the shop. */
export async function uploadShopLogo(profile: ShopProfile, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a picture (PNG, JPG or WebP)");
  if (file.size > 10 * 1024 * 1024) throw new Error("That picture is too big. Choose one under 10 MB");
  const body = await shrinkImage(file);

  const path = `${profile.shop_id}/logo-${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage.from("shop-logos").upload(path, body, { contentType: "image/png", upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("shop-logos").getPublicUrl(path);
  const { error } = await supabase.from("shop_settings").update({ logo_url: data.publicUrl }).eq("id", profile.id);
  if (error) throw error;

  // Tidy up the previous picture, if there was one (a failure here does not matter)
  const old = profile.logo_url?.split("/shop-logos/")[1];
  if (old) void supabase.storage.from("shop-logos").remove([decodeURIComponent(old)]);
  return data.publicUrl;
}

export async function removeShopLogo(profile: ShopProfile) {
  const { error } = await supabase.from("shop_settings").update({ logo_url: null }).eq("id", profile.id);
  if (error) throw error;
  const old = profile.logo_url?.split("/shop-logos/")[1];
  if (old) void supabase.storage.from("shop-logos").remove([decodeURIComponent(old)]);
}
