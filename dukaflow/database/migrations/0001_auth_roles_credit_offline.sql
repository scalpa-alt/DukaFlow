CREATE TYPE public.app_role AS ENUM ('owner', 'seller');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  lang text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.shop_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shop_name text NOT NULL DEFAULT 'My Shop',
  enforce_hours boolean NOT NULL DEFAULT false,
  open_time time NOT NULL DEFAULT '07:00',
  close_time time NOT NULL DEFAULT '21:00',
  timezone text NOT NULL DEFAULT 'Africa/Nairobi'
);
INSERT INTO public.shop_settings (id) VALUES (1);
GRANT SELECT, UPDATE ON public.shop_settings TO authenticated;
GRANT ALL ON public.shop_settings TO service_role;
ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.shop_is_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (NOT enforce_hours) OR
    ((now() AT TIME ZONE timezone)::time BETWEEN open_time AND close_time)
    FROM public.shop_settings WHERE id = 1), true)
$$;

CREATE OR REPLACE FUNCTION public.can_operate()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'owner')
      OR (public.has_role(auth.uid(), 'seller') AND public.shop_is_open())
$$;

-- First person to sign up becomes Owner, everyone after is a Seller.
CREATE OR REPLACE FUNCTION public.claim_role()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  LOCK TABLE public.user_roles IN EXCLUSIVE MODE;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid()
    ORDER BY (role = 'owner') DESC LIMIT 1;
  IF v_role IS NULL THEN
    v_role := CASE WHEN EXISTS (SELECT 1 FROM public.user_roles) THEN 'seller' ELSE 'owner' END;
    INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), v_role);
  END IF;
  INSERT INTO public.profiles (id, display_name)
  VALUES (auth.uid(), coalesce((SELECT split_part(email, '@', 1) FROM auth.users WHERE id = auth.uid()), ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN v_role::text;
END; $$;

CREATE POLICY "Own or owner reads roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Owner manages roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Staff read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_staff() OR id = auth.uid());
CREATE POLICY "Own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Staff read settings" ON public.shop_settings FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "Owner updates settings" ON public.shop_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));

-- Customers and credit
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  credit_limit numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read customers" ON public.customers FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "Operating staff add customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (public.can_operate());
CREATE POLICY "Owner edits customers" ON public.customers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Owner deletes customers" ON public.customers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

ALTER TABLE public.sales ADD COLUMN customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN created_by uuid;
ALTER TABLE public.sales ADD COLUMN client_ref text UNIQUE;
ALTER TABLE public.sales ADD COLUMN checkout_request_id text;
ALTER TABLE public.sales ADD COLUMN stock_conflict boolean NOT NULL DEFAULT false;
UPDATE public.sales SET amount_paid = total WHERE payment_status = 'paid';

CREATE TABLE public.credit_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  method text NOT NULL DEFAULT 'cash',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_repayments TO authenticated;
GRANT ALL ON public.credit_repayments TO service_role;
ALTER TABLE public.credit_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read repayments" ON public.credit_repayments FOR SELECT TO authenticated USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.checkout_sale_v2(
  p_items jsonb, p_payment_method text DEFAULT 'cash', p_customer_id uuid DEFAULT NULL,
  p_client_ref text DEFAULT NULL, p_created_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_id uuid; v_item jsonb; v_product public.products; v_qty integer;
  v_total numeric(12,2) := 0; v_count integer := 0; v_new_qty integer;
  v_conflict boolean := false; v_status text;
BEGIN
  IF NOT public.can_operate() THEN RAISE EXCEPTION 'Shop is closed or you are not allowed to sell'; END IF;
  IF p_payment_method NOT IN ('cash','mpesa','credit') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF p_payment_method = 'credit' AND p_customer_id IS NULL THEN RAISE EXCEPTION 'Pick a customer for a credit sale'; END IF;
  IF p_client_ref IS NOT NULL THEN
    SELECT id INTO v_sale_id FROM public.sales WHERE client_ref = p_client_ref;
    IF FOUND THEN RETURN v_sale_id; END IF;
  END IF;
  v_status := CASE p_payment_method WHEN 'cash' THEN 'paid' WHEN 'mpesa' THEN 'pending' ELSE 'unpaid' END;

  INSERT INTO public.sales (total, item_count, payment_method, payment_status, customer_id, created_by, client_ref, created_at)
  VALUES (0, 0, p_payment_method, v_status, p_customer_id, auth.uid(), p_client_ref, coalesce(p_created_at, now()))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := greatest(1, (v_item->>'quantity')::int);
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_product.quantity < v_qty THEN v_conflict := true; END IF;
    v_new_qty := greatest(0, v_product.quantity - v_qty);
    INSERT INTO public.sale_items (sale_id, product_id, product_name, barcode, unit_price, quantity, line_total, created_at)
    VALUES (v_sale_id, v_product.id, v_product.name, v_product.barcode, v_product.price, v_qty, v_product.price * v_qty, coalesce(p_created_at, now()));
    UPDATE public.products SET quantity = v_new_qty, updated_at = now() WHERE id = v_product.id;
    INSERT INTO public.stock_movements (product_id, change, resulting_quantity, reason, sale_id)
    VALUES (v_product.id, -v_qty, v_new_qty, 'sale', v_sale_id);
    v_total := v_total + v_product.price * v_qty;
    v_count := v_count + v_qty;
  END LOOP;

  UPDATE public.sales SET total = v_total, item_count = v_count, stock_conflict = v_conflict,
    amount_paid = CASE WHEN v_status = 'paid' THEN v_total ELSE 0 END
  WHERE id = v_sale_id;
  RETURN v_sale_id;
END; $$;

-- Repayments go to the oldest unpaid credit sale first.
CREATE OR REPLACE FUNCTION public.record_repayment(p_customer_id uuid, p_amount numeric, p_method text DEFAULT 'cash')
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_left numeric(12,2) := p_amount; v_sale record; v_due numeric(12,2); v_apply numeric(12,2);
BEGIN
  IF NOT public.can_operate() THEN RAISE EXCEPTION 'Shop is closed or you are not allowed to do this'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than 0'; END IF;
  INSERT INTO public.credit_repayments (customer_id, amount, method, created_by) VALUES (p_customer_id, p_amount, coalesce(p_method,'cash'), auth.uid());
  FOR v_sale IN SELECT id, total, amount_paid FROM public.sales
    WHERE customer_id = p_customer_id AND payment_method = 'credit' AND payment_status IN ('unpaid','partial')
    ORDER BY created_at ASC FOR UPDATE LOOP
    EXIT WHEN v_left <= 0;
    v_due := v_sale.total - v_sale.amount_paid;
    v_apply := least(v_due, v_left);
    UPDATE public.sales SET amount_paid = amount_paid + v_apply,
      payment_status = CASE WHEN amount_paid + v_apply >= total THEN 'paid' ELSE 'partial' END
    WHERE id = v_sale.id;
    v_left := v_left - v_apply;
  END LOOP;
  RETURN v_left; -- anything left over was more than the debt
END; $$;

REVOKE EXECUTE ON FUNCTION public.checkout_sale(jsonb, text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.checkout_sale_v2(jsonb, text, uuid, text, timestamptz) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_repayment(uuid, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.claim_role() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.checkout_sale_v2(jsonb, text, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_repayment(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_role() TO authenticated;

-- Replace the old open policies with role-based ones.
DROP POLICY "Shop app can delete products" ON public.products;
DROP POLICY "Shop app can insert products" ON public.products;
DROP POLICY "Shop app can read products" ON public.products;
DROP POLICY "Shop app can update products" ON public.products;
DROP POLICY "Shop app can delete sale items" ON public.sale_items;
DROP POLICY "Shop app can insert sale items" ON public.sale_items;
DROP POLICY "Shop app can read sale items" ON public.sale_items;
DROP POLICY "Shop app can update sale items" ON public.sale_items;
DROP POLICY "Shop app can delete sales" ON public.sales;
DROP POLICY "Shop app can insert sales" ON public.sales;
DROP POLICY "Shop app can read sales" ON public.sales;
DROP POLICY "Shop app can update sales" ON public.sales;
DROP POLICY "Shop app can insert movements" ON public.stock_movements;
DROP POLICY "Shop app can read movements" ON public.stock_movements;
DROP POLICY "Shop app can insert mpesa payments" ON public.mpesa_payments;
DROP POLICY "Shop app can read mpesa payments" ON public.mpesa_payments;
DROP POLICY "Shop app can update mpesa payments" ON public.mpesa_payments;

REVOKE ALL ON public.products, public.sale_items, public.sales, public.stock_movements, public.mpesa_payments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.sale_items, public.sales, public.stock_movements, public.mpesa_payments TO authenticated;

CREATE POLICY "Staff read products" ON public.products FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "Owner inserts products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Owner updates products" ON public.products FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'owner')) WITH CHECK (public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Owner deletes products" ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Staff read sales" ON public.sales FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "Operating staff update sales" ON public.sales FOR UPDATE TO authenticated USING (public.can_operate()) WITH CHECK (public.can_operate());
CREATE POLICY "Owner deletes sales" ON public.sales FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Staff read sale items" ON public.sale_items FOR SELECT TO authenticated USING (public.is_staff());

CREATE POLICY "Staff read movements" ON public.stock_movements FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "Owner logs movements" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Staff read mpesa" ON public.mpesa_payments FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "Operating staff match mpesa" ON public.mpesa_payments FOR UPDATE TO authenticated USING (public.can_operate()) WITH CHECK (public.can_operate());
