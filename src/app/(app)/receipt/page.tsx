"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Printer, Share2, Store } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";
import { usePrefs } from "@/lib/prefs";
import { fetchSale, fetchShopProfile, formatMoney, type Sale, type SaleItem, type ShopProfile } from "@/lib/shop";

export default function ReceiptPage() {
  // useSearchParams needs a Suspense boundary around it
  return (
    <Suspense fallback={null}>
      <Receipt />
    </Suspense>
  );
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const receiptNumber = (sale: Sale) => sale.id.slice(0, 8).toUpperCase();

/** The same receipt as plain text, for WhatsApp, SMS or email. */
function receiptText(shop: ShopProfile | null | undefined, sale: Sale, items: SaleItem[], methodLabel: string) {
  const lines: string[] = [];
  lines.push(shop?.shop_name ?? "Receipt");
  if (shop?.address) lines.push(shop.address);
  if (shop?.contact_phone) lines.push(`Tel: ${shop.contact_phone}`);
  if (shop?.contact_email) lines.push(shop.contact_email);
  lines.push("", `Receipt #${receiptNumber(sale)}`, formatWhen(sale.created_at), "");
  for (const i of items) lines.push(`${i.product_name} x${i.quantity}  ${formatMoney(Number(i.line_total))}`);
  lines.push("", `TOTAL: ${formatMoney(Number(sale.total))}`, `Paid by: ${methodLabel}`);
  if (shop?.receipt_footer) lines.push("", shop.receipt_footer);
  return lines.join("\n");
}

function Receipt() {
  const { t } = usePrefs();
  const saleId = useSearchParams().get("sale");

  const sale = useQuery({ queryKey: ["sale", saleId], enabled: Boolean(saleId), queryFn: () => fetchSale(saleId as string) });
  const shop = useQuery({ queryKey: ["shop-profile"], queryFn: fetchShopProfile });

  if (!saleId) return <p className="px-4 pt-10 text-center text-muted-foreground">No sale chosen.</p>;
  if (sale.isLoading) return <p className="px-4 pt-10 text-center text-muted-foreground">Loading receipt…</p>;
  if (!sale.data) return <p className="px-4 pt-10 text-center text-muted-foreground">Receipt not found.</p>;

  const { sale: s, items } = sale.data;
  const p = shop.data;
  const methodLabel = s.payment_method === "cash" ? t("cash") : s.payment_method === "mpesa" ? t("mpesa") : t("credit");
  const statusLabel = s.payment_status === "paid" ? t("paid") : s.payment_status === "pending" ? t("pending") : t("unpaid");
  const text = receiptText(p, s, items, methodLabel);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const owing = s.payment_method === "credit" ? Math.max(0, Number(s.total) - Number(s.amount_paid ?? 0)) : 0;

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <div className="no-print flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">Receipt</h1>
        <Link href="/" className={buttonClass("secondary", "sm")}>
          New sale
        </Link>
      </div>

      <article className="receipt mx-auto w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-sm shadow-sm">
        <header className="space-y-1 text-center">
          {p?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.logo_url} alt="" className="mx-auto mb-1 max-h-20 max-w-[60%] object-contain" crossOrigin="anonymous" />
          ) : (
            <Store className="mx-auto mb-1 size-8 text-muted-foreground" />
          )}
          <h2 className="font-display text-lg font-bold">{p?.shop_name ?? "DukaFlow"}</h2>
          {p?.address ? <p>{p.address}</p> : null}
          {p?.contact_phone ? <p>Tel: {p.contact_phone}</p> : null}
          {p?.contact_email ? <p>{p.contact_email}</p> : null}
          {p?.owner_name ? <p className="text-muted-foreground">Owner: {p.owner_name}</p> : null}
        </header>

        <div className="my-3 border-t border-dashed border-border" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Receipt #{receiptNumber(s)}</span>
          <span>{formatWhen(s.created_at)}</span>
        </div>

        <ul className="my-3 divide-y divide-dashed divide-border">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0">
                {i.product_name}
                <span className="block text-xs text-muted-foreground">
                  {i.quantity} × {formatMoney(Number(i.unit_price))}
                </span>
              </span>
              <span className="shrink-0 font-medium">{formatMoney(Number(i.line_total))}</span>
            </li>
          ))}
        </ul>

        <div className="border-t border-dashed border-border pt-2">
          <div className="flex justify-between font-display text-base font-bold">
            <span>{t("total").toUpperCase()}</span>
            <span>{formatMoney(Number(s.total))}</span>
          </div>
          <div className="mt-1 flex justify-between text-muted-foreground">
            <span>{methodLabel}</span>
            <span>{statusLabel}</span>
          </div>
          {owing > 0 ? (
            <div className="mt-1 flex justify-between font-medium">
              <span>Balance owed</span>
              <span>{formatMoney(owing)}</span>
            </div>
          ) : null}
        </div>

        {p?.receipt_footer ? <p className="mt-4 text-center text-xs text-muted-foreground">{p.receipt_footer}</p> : null}
      </article>

      <div className="no-print mx-auto flex max-w-sm flex-col gap-2">
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 size-4" />
          Print receipt
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <a
            className={buttonClass("secondary")}
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="mr-2 size-4" />
            WhatsApp
          </a>
          {canShare ? (
            <Button variant="secondary" onClick={() => void navigator.share({ title: `Receipt #${receiptNumber(s)}`, text }).catch(() => undefined)}>
              <Share2 className="mr-2 size-4" />
              Share
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(text)}>
              Copy text
            </Button>
          )}
        </div>
        {!p?.owner_name && !p?.contact_phone ? (
          <p className="text-center text-xs text-muted-foreground">The shop owner can add a logo and contacts in Settings → Receipt details.</p>
        ) : null}
      </div>
    </div>
  );
}
