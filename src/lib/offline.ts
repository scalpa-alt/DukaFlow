import { supabase } from "@/lib/supabase";

// Sales rung up with no internet wait here (in the phone's storage) until the connection is back.

export type QueuedSale = {
  client_ref: string;
  items: { product_id: string; quantity: number; name: string; price: number }[];
  method: "cash" | "mpesa" | "credit";
  customer_id: string | null;
  created_at: string;
  total: number;
  error?: string;
};

const QUEUE_KEY = "dukaflow.queue";
const listeners = new Set<() => void>();

export function getQueue(): QueuedSale[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedSale[];
  } catch {
    return [];
  }
}

function setQueue(queue: QueuedSale[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  listeners.forEach((fn) => fn());
}

export function onQueueChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function enqueue(sale: QueuedSale) {
  setQueue([...getQueue(), sale]);
}

export function discardQueued(clientRef: string) {
  setQueue(getQueue().filter((q) => q.client_ref !== clientRef));
}

export function isNetworkError(e: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = String((e as { message?: string })?.message ?? e);
  return /fetch|network|load failed/i.test(message);
}

let syncing = false;

/** Sends every queued sale to the database. Each sale carries its own reference, so nothing is counted twice. */
export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    for (const sale of getQueue()) {
      const { error } = await supabase.rpc("checkout_sale_v2", {
        p_items: sale.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
        p_payment_method: sale.method,
        ...(sale.customer_id ? { p_customer_id: sale.customer_id } : {}),
        p_client_ref: sale.client_ref,
        p_created_at: sale.created_at,
      });
      if (!error) {
        synced++;
        discardQueued(sale.client_ref);
      } else if (isNetworkError(error)) {
        break; // still offline, try again later
      } else {
        failed++;
        setQueue(getQueue().map((q) => (q.client_ref === sale.client_ref ? { ...q, error: error.message } : q)));
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}
