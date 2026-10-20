import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Sends an M-Pesa STK Push (payment prompt) to the customer's phone via Safaricom Daraja.
// Needs secrets: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY,
// optional MPESA_ENV ("production" | "sandbox"), MPESA_CALLBACK_URL, MPESA_CALLBACK_TOKEN.
export const sendStkPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ saleId: z.string().uuid(), phone: z.string().min(9).max(15) }).parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env["MPESA_CONSUMER_KEY"];
    const secret = process.env["MPESA_CONSUMER_SECRET"];
    const shortcode = process.env["MPESA_SHORTCODE"];
    const passkey = process.env["MPESA_PASSKEY"];
    if (!key || !secret || !shortcode || !passkey) {
      return { ok: false as const, message: "M-Pesa prompts aren't set up yet. Ask the owner to add the Safaricom Daraja keys." };
    }
    const { data: sale, error } = await context.supabase.from("sales").select("id,total").eq("id", data.saleId).maybeSingle();
    if (error || !sale) return { ok: false as const, message: "Sale not found" };

    let phone = data.phone.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "254" + phone.slice(1);
    if (!/^254\d{9}$/.test(phone)) return { ok: false as const, message: "Enter a Kenyan phone number like 0712345678" };

    const base = process.env["MPESA_ENV"] === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
    const tokRes = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    });
    if (!tokRes.ok) return { ok: false as const, message: "Could not reach M-Pesa. Check the Daraja keys." };
    const { access_token } = (await tokRes.json()) as { access_token: string };

    const ts = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\D/g, "").slice(0, 14);
    const tokenQ = process.env["MPESA_CALLBACK_TOKEN"] ? `?token=${process.env["MPESA_CALLBACK_TOKEN"]}` : "";
    const callback = process.env["MPESA_CALLBACK_URL"] ?? `https://shopsplugkenya.lovable.app/api/public/mpesa/callback${tokenQ}`;
    const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: btoa(`${shortcode}${passkey}${ts}`),
        Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.ceil(Number(sale.total)),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callback,
        AccountReference: "DukaFlow",
        TransactionDesc: "Shop sale",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { CheckoutRequestID?: string; errorMessage?: string; ResponseCode?: string };
    if (!res.ok || body.ResponseCode !== "0" || !body.CheckoutRequestID) {
      return { ok: false as const, message: body.errorMessage ?? "M-Pesa did not accept the request" };
    }
    await context.supabase.from("sales").update({ checkout_request_id: body.CheckoutRequestID }).eq("id", sale.id);
    return { ok: true as const, message: "Prompt sent. Ask the customer to enter their M-Pesa PIN." };
  });
