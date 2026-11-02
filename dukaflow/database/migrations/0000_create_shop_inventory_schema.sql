-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text UNIQUE,
  name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'General',
  low_stock_threshold integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated, anon;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop app can read products" ON public.products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Shop app can insert products" ON public.products FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Shop app can update products" ON public.products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shop app can delete products" ON public.products FOR DELETE TO anon, authenticated USING (true);

-- Sales
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total numeric(12,2) NOT NULL DEFAULT 0,
  item_count integer NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  payment_status text NOT NULL DEFAULT 'paid',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated, anon;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop app can read sales" ON public.sales FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Shop app can insert sales" ON public.sales FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Shop app can update sales" ON public.sales FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shop app can delete sales" ON public.sales FOR DELETE TO anon, authenticated USING (true);

-- Sale items
CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  barcode text,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_items_sale_id_idx ON public.sale_items(sale_id);
CREATE INDEX sale_items_created_at_idx ON public.sale_items(created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_items TO authenticated, anon;
GRANT ALL ON public.sale_items TO service_role;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop app can read sale items" ON public.sale_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Shop app can insert sale items" ON public.sale_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Shop app can update sale items" ON public.sale_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Shop app can delete sale items" ON public.sale_items FOR DELETE TO anon, authenticated USING (true);

-- Stock movements (history)
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  change integer NOT NULL,
  resulting_quantity integer,
  reason text NOT NULL DEFAULT 'manual',
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON public.stock_movements(product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated, anon;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop app can read movements" ON public.stock_movements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Shop app can insert movements" ON public.stock_movements FOR INSERT TO anon, authenticated WITH CHECK (true);

-- M-Pesa payments (populated by Daraja webhook)
CREATE TABLE public.mpesa_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text UNIQUE NOT NULL,
  payer_name text,
  payer_phone text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_at timestamptz NOT NULL DEFAULT now(),
  matched_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mpesa_payments_paid_at_idx ON public.mpesa_payments(paid_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mpesa_payments TO authenticated, anon;
GRANT ALL ON public.mpesa_payments TO service_role;
ALTER TABLE public.mpesa_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shop app can read mpesa payments" ON public.mpesa_payments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Shop app can insert mpesa payments" ON public.mpesa_payments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Shop app can update mpesa payments" ON public.mpesa_payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Atomic checkout: create sale, lines, decrement stock, log movements
CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_items jsonb,
  p_payment_method text DEFAULT 'cash',
  p_payment_status text DEFAULT 'paid'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_total numeric(12,2) := 0;
  v_count integer := 0;
  v_new_qty integer;
BEGIN
  INSERT INTO public.sales (total, item_count, payment_method, payment_status)
  VALUES (0, 0, coalesce(p_payment_method, 'cash'), coalesce(p_payment_status, 'paid'))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := greatest(1, (v_item->>'quantity')::int);
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found';
    END IF;

    v_new_qty := greatest(0, v_product.quantity - v_qty);

    INSERT INTO public.sale_items (sale_id, product_id, product_name, barcode, unit_price, quantity, line_total)
    VALUES (v_sale_id, v_product.id, v_product.name, v_product.barcode, v_product.price, v_qty, v_product.price * v_qty);

    UPDATE public.products SET quantity = v_new_qty, updated_at = now() WHERE id = v_product.id;

    INSERT INTO public.stock_movements (product_id, change, resulting_quantity, reason, sale_id)
    VALUES (v_product.id, -v_qty, v_new_qty, 'sale', v_sale_id);

    v_total := v_total + (v_product.price * v_qty);
    v_count := v_count + v_qty;
  END LOOP;

  UPDATE public.sales SET total = v_total, item_count = v_count WHERE id = v_sale_id;
  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_sale(jsonb, text, text) TO anon, authenticated, service_role;

-- Demo products so the first screen is not empty
INSERT INTO public.products (barcode, name, price, quantity, category, low_stock_threshold) VALUES
  ('6001234567890', 'Maize Flour 2kg', 180.00, 24, 'Groceries', 6),
  ('6009876543210', 'Cooking Oil 1L', 320.00, 4, 'Groceries', 5),
  ('5449000000996', 'Coca-Cola 500ml', 70.00, 48, 'Drinks', 12),
  ('6001111222333', 'Bar Soap 800g', 210.00, 0, 'Household', 4),
  ('6004444555666', 'Sugar 1kg', 165.00, 9, 'Groceries', 10),
  ('6007777888999', 'Exercise Book A5', 45.00, 60, 'Stationery', 15);
