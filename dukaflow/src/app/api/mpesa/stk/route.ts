import { authenticate, json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends an M-Pesa payment prompt (STK Push) to the customer's phone through Safaricom Daraja.
// Needs: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY.
// Optional: MPESA_ENV ("production" for real payments, anything else is the sandbox), MPESA_CALLBACK_URL, MPESA_CALLBACK_TOKEN.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return json({ ok: false, message: "Please sign in again." }, 401);

  const body = (await request.json().catch(() => null)) as { saleId?: unknown; phone?: unknown } | null;
  const saleId = typeof body?.saleId === "string" ? body.saleId : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone : "";
  if (!/^[0-9a-f-]{36}$/i.test(saleId) || rawPhone.length < 9 || rawPhone.length > 15) {
    return json({ ok: false, message: "Check the sale and the phone number." }, 400);
  }

  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!key || !secret || !shortcode || !passkey) {
    return json({ ok: false, message: "M-Pesa prompts aren't set up yet. Ask the owner to add the Safaricom Daraja keys." });
  }

  // The sale is read as the signed-in user, so people can only charge sales from their own shop.
  const { data: sale } = await auth.supabase.from("sales").select("id,total").eq("id", saleId).maybeSingle();
  if (!sale) return json({ ok: false, message: "Sale not found." });

  // Accept 0712345678, 712345678, 254712345678 and +254712345678
  let phone = rawPhone.replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  else if (/^[71]\d{8}$/.test(phone)) phone = "254" + phone;
  if (!/^254\d{9}$/.test(phone)) {
    return json({ ok: false, message: "Enter a Kenyan phone number like 0712345678." });
  }

  // Real money only when MPESA_ENV is exactly "production"; anything else uses Safaricom's test system.
  const base = process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

  const tokenRes = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
  });
  if (!tokenRes.ok) return json({ ok: false, message: "Could not reach M-Pesa. Check the Daraja keys." });
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Daraja wants the time in Nairobi (UTC+3) as YYYYMMDDHHmmss
  const timestamp = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\D/g, "").slice(0, 14);
  const tokenQuery = process.env.MPESA_CALLBACK_TOKEN ? `?token=${encodeURIComponent(process.env.MPESA_CALLBACK_TOKEN)}` : "";
  const callbackUrl =
    process.env.MPESA_CALLBACK_URL || `${new URL(request.url).origin}/api/public/mpesa/callback${tokenQuery}`;

  const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64"),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.ceil(Number(sale.total)),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: "DukaFlow",
      TransactionDesc: "Shop sale",
    }),
  });
  const result = (await res.json().catch(() => ({}))) as {
    CheckoutRequestID?: string;
    errorMessage?: string;
    ResponseCode?: string;
  };
  if (!res.ok || result.ResponseCode !== "0" || !result.CheckoutRequestID) {
    return json({ ok: false, message: result.errorMessage ?? "M-Pesa did not accept the request." });
  }

  // Remember which sale this prompt belongs to, so the callback can mark it paid on its own.
  await auth.supabase.from("sales").update({ checkout_request_id: result.CheckoutRequestID }).eq("id", sale.id);
  return json({ ok: true, message: "Prompt sent. Ask the customer to enter their M-Pesa PIN." });
}
