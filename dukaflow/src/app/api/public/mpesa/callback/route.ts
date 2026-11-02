import { adminClient } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Safaricom calls this address when a customer pays. Nobody is signed in here, so it uses the
// server-only service key. Two kinds of message arrive:
//   1. STK Push result (Body.stkCallback): matched to the sale automatically.
//   2. C2B payment to the till or paybill (TransID): saved for the shop to match by hand.
//      Add ?shop=<shop id> to the C2B URL so the payment lands in the right shop.
// If MPESA_CALLBACK_TOKEN is set, the callback URL must carry ?token=<that value>.

type Item = { Name: string; Value?: string | number };

const accepted = () => Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
const rejected = (desc: string, status: number) => Response.json({ ResultCode: 1, ResultDesc: desc }, { status });

export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.MPESA_CALLBACK_TOKEN;
  if (secret && url.searchParams.get("token") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return rejected("Bad JSON", 400);
  }

  let checkoutId: string | null = null;
  let row: { transaction_id: string; amount: number; payer_name: string | null; payer_phone: string | null } | null = null;

  const stk = body?.Body?.stkCallback;
  if (stk) {
    // ResultCode other than 0 means the customer cancelled or it failed: nothing to record.
    if (stk.ResultCode !== 0) return accepted();
    checkoutId = stk.CheckoutRequestID ?? null;
    const items: Item[] = stk.CallbackMetadata?.Item ?? [];
    const get = (name: string) => items.find((i) => i.Name === name)?.Value;
    row = {
      transaction_id: String(get("MpesaReceiptNumber") ?? ""),
      amount: Number(get("Amount") ?? 0),
      payer_name: null,
      payer_phone: get("PhoneNumber") ? String(get("PhoneNumber")) : null,
    };
  } else if (body?.TransID) {
    row = {
      transaction_id: String(body.TransID),
      amount: Number(body.TransAmount ?? 0),
      payer_name: [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(" ") || null,
      payer_phone: body.MSISDN ? String(body.MSISDN) : null,
    };
  }

  if (!row || !row.transaction_id || !(row.amount > 0)) return rejected("Unrecognised payload", 400);

  let admin;
  try {
    admin = adminClient();
  } catch (e) {
    console.error("mpesa callback: server is not configured", e);
    return rejected("Server not configured", 500);
  }

  // Which sale and shop does this payment belong to?
  let matched: { matched_sale_id: string; shop_id: string | null } | null = null;
  if (checkoutId) {
    const { data: sale } = await admin.from("sales").select("id,shop_id").eq("checkout_request_id", checkoutId).maybeSingle();
    if (sale) matched = { matched_sale_id: sale.id, shop_id: sale.shop_id };
  }
  const shopParam = url.searchParams.get("shop");
  const shopFromUrl = shopParam && /^[0-9a-f-]{36}$/i.test(shopParam) ? shopParam : null;

  const { error } = await admin.from("mpesa_payments").upsert(
    {
      ...row,
      raw_payload: body,
      ...(matched ?? {}),
      ...(!matched && shopFromUrl ? { shop_id: shopFromUrl } : {}),
    },
    { onConflict: "transaction_id" },
  );
  if (error) {
    console.error("mpesa callback: could not save payment", error);
    return rejected("Storage error", 500);
  }

  if (matched) {
    await admin
      .from("sales")
      .update({ payment_status: "paid", amount_paid: row.amount })
      .eq("id", matched.matched_sale_id);
  }
  return accepted();
}
