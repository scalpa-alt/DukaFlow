import { stockStatus, type Product } from "@/lib/shop";
import { usePrefs } from "@/lib/prefs";

export function StockBadge({
  product,
}: {
  product: Pick<Product, "quantity" | "low_stock_threshold">;
}) {
  const { t } = usePrefs();
  const status = stockStatus(product);
  if (status === "out") {
    return (
      <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
        {t("outOfStock")}
      </span>
    );
  }
  if (status === "low") {
    return (
      <span className="inline-flex items-center rounded-full bg-warning/25 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
        {t("lowStock")} · {product.quantity} {t("left")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
      {t("inStock")} · {product.quantity}
    </span>
  );
}
