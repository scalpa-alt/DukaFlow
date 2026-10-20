import { createFileRoute } from "@tanstack/react-router";

// Daraja (Safaricom) C2B confirmation / STK Push callback receiver.
// Records payments into mpesa_payments; sellers match them on the Payments screen.
type Item = { Name: string; Value?: string | number };

export const Route = createFileRoute("/api/public/mpesa/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["MPESA_CALLBACK_TOKEN"];
        if (secret && new URL(request.url).searchParams.get("token") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ResultCode: 1, ResultDesc: "Bad JSON" }, { status: 400 });
        }

        let checkoutId: string | null = null;
        let row: { transaction_id: string; amount: number; payer_name: string | null; payer_phone: string | null } | null = null;
        const stk = body?.Body?.stkCallback;
        if (stk) {
          if (stk.ResultCode !== 0) return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
          checkoutId = stk.CheckoutRequestID ?? null;
          const items: Item[] = stk.CallbackMetadata?.Item ?? [];
          const get = (n: string) => items.find((i) => i.Name === n)?.Value;
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
        if (!row || !row.transaction_id || !(row.amount > 0)) {
          return Response.json({ ResultCode: 1, ResultDesc: "Unrecognised payload" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("mpesa_payments")
          .upsert({ ...row, raw_payload: body }, { onConflict: "transaction_id" });
        if (error) {
          console.error("mpesa callback insert failed", error);
          return Response.json({ ResultCode: 1, ResultDesc: "Storage error" }, { status: 500 });
        }
        // STK Push replies carry the CheckoutRequestID we saved on the sale: match automatically.
        if (checkoutId) {
          const { data: sale } = await supabaseAdmin.from("sales").select("id").eq("checkout_request_id", checkoutId).maybeSingle();
          if (sale) {
            await supabaseAdmin.from("mpesa_payments").update({ matched_sale_id: sale.id }).eq("transaction_id", row.transaction_id);
            await supabaseAdmin.from("sales").update({ payment_status: "paid", amount_paid: row.amount }).eq("id", sale.id);
          }
        }
        return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
      },
    },
  },
});
