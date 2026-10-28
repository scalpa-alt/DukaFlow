import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Emails the shop's join code to the signed-in shop owner (via Resend, https://resend.com).
// Needs secrets: RESEND_API_KEY, optional MAIL_FROM (default "DukaFlow <onboarding@resend.dev>").
// Note: with the default sender, Resend only delivers to your own Resend account email.
// Verify a domain in Resend and set MAIL_FROM to send to every owner.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const sendJoinCodeEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = process.env["RESEND_API_KEY"];
    if (!key) {
      return { ok: false as const, message: "Email isn't set up yet. Add the RESEND_API_KEY secret to send shop codes by email." };
    }
    const email = typeof context.claims.email === "string" ? context.claims.email : null;
    if (!email) return { ok: false as const, message: "Your account has no email address." };

    const { data: isOwner } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "owner" });
    if (!isOwner) return { ok: false as const, message: "Only the shop owner can request the shop code." };

    const { data: shopId } = await context.supabase.rpc("current_shop_id");
    if (!shopId) return { ok: false as const, message: "You don't belong to a shop yet." };
    const { data: shop, error } = await context.supabase.from("shops").select("name,join_code").eq("id", shopId as string).maybeSingle();
    if (error || !shop) return { ok: false as const, message: "Shop not found." };

    const from = process.env["MAIL_FROM"] ?? "DukaFlow <onboarding@resend.dev>";
    const subject = `Your DukaFlow shop code for ${shop.name}`;
    const text = `Your shop code for ${shop.name} is ${shop.join_code}.\n\nGive this code only to staff you trust. They enter it after creating an account to join your shop as sellers.`;
    const html = `<p>Your shop code for <strong>${esc(shop.name)}</strong> is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px">${esc(shop.join_code)}</p>
<p>Give this code only to staff you trust. They enter it after creating an account to join your shop as sellers.</p>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false as const, message: body.message ?? "The email could not be sent." };
    }
    return { ok: true as const, message: `Shop code sent to ${email}` };
  });
