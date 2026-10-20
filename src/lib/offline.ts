import { supabase } from "@/integrations/supabase/client";

export type QueuedSale = {
  client_ref: string;
  items: { product_id: string; quantity: number; name: string; price: number }[];
  method: "cash" | "mpesa" | "credit";
  customer_id: string | null;
  created_at: string;
  total: number;
  error?: string;
};

const Q_KEY = "dukaflow.queue";
const listeners = new Set<() => void>();

export function getQueue(): QueuedSale[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(Q_KEY) ?? "[]") as QueuedSale[]; } catch { return []; }
}
function setQueue(q: QueuedSale[]) {
  localStorage.setItem(Q_KEY, JSON.stringify(q));
  listeners.forEach((l) => l());
}
export function onQueueChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function enqueue(s: QueuedSale) { setQueue([...getQueue(), s]); }
export function discardQueued(ref: string) { setQueue(getQueue().filter((q) => q.client_ref !== ref)); }

export function isNetworkError(e: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const m = String((e as { message?: string })?.message ?? e);
  return /fetch|network|load failed/i.test(m);
}

let syncing = false;
export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0, failed = 0;
  try {
    for (const s of getQueue()) {
      const { error } = await supabase.rpc("checkout_sale_v2", {
        p_items: s.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        p_payment_method: s.method,
        ...(s.customer_id ? { p_customer_id: s.customer_id } : {}),
        p_client_ref: s.client_ref,
        p_created_at: s.created_at,
      });
      if (!error) { synced++; discardQueued(s.client_ref); }
      else if (isNetworkError(error)) break;
      else { failed++; setQueue(getQueue().map((q) => (q.client_ref === s.client_ref ? { ...q, error: error.message } : q))); }
    }
  } finally { syncing = false; }
  return { synced, failed };
}
