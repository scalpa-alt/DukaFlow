import { authenticate, json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Emails the shop's join code to the signed-in shop owner, using Resend (https://resend.com).
// Needs: RESEND_API_KEY. Optional: MAIL_FROM, for example "DukaFlow <codes@yourdomain.com>".
// Until you verify a domain in Resend, the default sender can only deliver to your own Resend account email.

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return json({ ok: false, message: "Please sign in again." }, 401);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ ok: false, message: "Email isn't set up yet. Add the RESEND_API_KEY secret to send shop codes by email." });
  }

  const email = auth.user.email;
  if (!email) return json({ ok: false, message: "Your account has no email address." });

  // Only the owner of a shop may ask for its code
  const { data: isOwner } = await auth.supabase.rpc("has_role", { _user_id: auth.user.id, _role: "owner" });
  if (!isOwner) return json({ ok: false, message: "Only the shop owner can request the shop code." });

  const { data: shopId } = await auth.supabase.rpc("current_shop_id");
  if (!shopId) return json({ ok: false, message: "You don't belong to a shop yet." });

  const { data: shop } = await auth.supabase.from("shops").select("name,join_code").eq("id", shopId).maybeSingle();
  if (!shop) return json({ ok: false, message: "Shop not found." });

  const from = process.env.MAIL_FROM || "DukaFlow <onboarding@resend.dev>";
  const subject = `Your DukaFlow shop code for ${shop.name}`;
  const text =
    `Your shop code for ${shop.name} is ${shop.join_code}.\n\n` +
    `Give this code only to staff you trust. They enter it after creating an account to join your shop as sellers.`;
  const html =
    `<p>Your shop code for <strong>${escapeHtml(shop.name)}</strong> is:</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${escapeHtml(shop.join_code)}</p>` +
    `<p>Give this code only to staff you trust. They enter it after creating an account to join your shop as sellers.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, text, html }),
  });
  if (!res.ok) {
    const failure = (await res.json().catch(() => ({}))) as { message?: string };
    return json({ ok: false, message: failure.message ?? "The email could not be sent." });
  }
  return json({ ok: true, message: `Shop code sent to ${email}` });
}
