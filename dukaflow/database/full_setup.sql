-- DukaFlow full database setup. Run ONCE on an empty Supabase project (SQL Editor -> paste all -> Run).
-- Step 0: remove the hand-made tables so the real ones can be created.
DROP TABLE IF EXISTS public.product_table, public.profile_names, public.sales_table,
  public.shop_setings, public.shops_table, public.user_roles CASCADE;

-- ===== migration 0000 =====
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

-- ===== migration 0001 =====
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

-- ===== migration 0002 =====
REVOKE EXECUTE ON FUNCTION public.checkout_sale(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_sale_v2(jsonb, text, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_repayment(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_role() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.checkout_sale_v2(jsonb, text, uuid, text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_repayment(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_role() FROM anon;

-- ===== migration 0003 =====
CREATE TYPE public.expense_category AS ENUM ('rent','restocking','transport','wages','utilities','other');
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.expense_category NOT NULL DEFAULT 'other',
  description text NOT NULL DEFAULT '',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT current_date,
  recorded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads expenses" ON public.expenses FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'owner'));
CREATE POLICY "Owner adds expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'owner'));
CREATE POLICY "Owner edits expenses" ON public.expenses FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));
CREATE POLICY "Owner deletes expenses" ON public.expenses FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner'));
ALTER TABLE public.products ADD COLUMN barcode_internal boolean NOT NULL DEFAULT false;

-- ===== migration 0004 =====
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read platform admins" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid())
$$;

-- Auto-grant platform admin to the overall owner email on signup
CREATE OR REPLACE FUNCTION public.grant_platform_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'scalpapsachal@gmail.com' THEN
    INSERT INTO public.platform_admins (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_platform_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_platform_admin();

-- ===== migration 0005 =====
CREATE POLICY "Platform admins read roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "Platform admins read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- ===== migration 0006 =====
CREATE TABLE public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid,
  join_code text NOT NULL UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 6)),
  trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  paid_until timestamptz,
  suspended boolean NOT NULL DEFAULT false,
  monthly_fee numeric(12,2) NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shops TO authenticated;
GRANT ALL ON public.shops TO service_role;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ADD COLUMN shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.current_shop_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT shop_id FROM public.user_roles WHERE user_id = auth.uid() AND shop_id IS NOT NULL ORDER BY (role = 'owner') DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.shop_active(_shop uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT NOT suspended AND (trial_ends_at > now() OR coalesce(paid_until, '-infinity') > now()) FROM public.shops WHERE id = _shop), false)
$$;

CREATE POLICY "Members read own shop" ON public.shops FOR SELECT TO authenticated USING (id = public.current_shop_id() OR public.is_platform_admin());

-- Backfill: one shop for the existing data
DO $$ DECLARE v_shop uuid; v_owner uuid; v_name text; BEGIN
  SELECT user_id INTO v_owner FROM public.user_roles WHERE role = 'owner' LIMIT 1;
  IF v_owner IS NOT NULL OR EXISTS (SELECT 1 FROM public.products) THEN
    SELECT coalesce((SELECT shop_name FROM public.shop_settings WHERE id = 1), 'My Shop') INTO v_name;
    INSERT INTO public.shops (name, owner_id) VALUES (v_name, v_owner) RETURNING id INTO v_shop;
    UPDATE public.user_roles SET shop_id = v_shop;
    PERFORM set_config('dukaflow.backfill_shop', v_shop::text, true);
  END IF;
END $$;

-- shop_id on every shop table, defaulting to the caller's shop
DO $$ DECLARE t text; v_shop uuid := nullif(current_setting('dukaflow.backfill_shop', true), '')::uuid; BEGIN
  FOREACH t IN ARRAY ARRAY['products','sales','sale_items','stock_movements','customers','credit_repayments','expenses','mpesa_payments','shop_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE DEFAULT public.current_shop_id()', t);
    IF v_shop IS NOT NULL THEN EXECUTE format('UPDATE public.%I SET shop_id = $1', t) USING v_shop; END IF;
    EXECUTE format('CREATE INDEX ON public.%I (shop_id)', t);
    IF t <> 'shop_settings' THEN
      EXECUTE format('CREATE POLICY "Same shop only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (shop_id = public.current_shop_id()) WITH CHECK (shop_id = public.current_shop_id())', t);
    END IF;
  END LOOP;
END $$;

CREATE SEQUENCE IF NOT EXISTS public.shop_settings_id_seq START 2;
ALTER TABLE public.shop_settings ALTER COLUMN id SET DEFAULT nextval('public.shop_settings_id_seq');
ALTER TABLE public.shop_settings ADD CONSTRAINT shop_settings_shop_unique UNIQUE (shop_id);
CREATE POLICY "Same shop only" ON public.shop_settings AS RESTRICTIVE FOR ALL TO authenticated USING (shop_id = public.current_shop_id()) WITH CHECK (shop_id = public.current_shop_id());

ALTER TABLE public.products DROP CONSTRAINT products_barcode_key;
ALTER TABLE public.products ADD CONSTRAINT products_shop_barcode_key UNIQUE (shop_id, barcode);

CREATE POLICY "Same shop roles" ON public.user_roles AS RESTRICTIVE FOR ALL TO authenticated
  USING (user_id = auth.uid() OR shop_id = public.current_shop_id() OR public.is_platform_admin())
  WITH CHECK (shop_id = public.current_shop_id());

CREATE OR REPLACE FUNCTION public.shop_is_open() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (NOT enforce_hours) OR ((now() AT TIME ZONE timezone)::time BETWEEN open_time AND close_time)
    FROM public.shop_settings WHERE shop_id = public.current_shop_id()), true)
$$;

CREATE OR REPLACE FUNCTION public.can_operate() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.shop_active(public.current_shop_id()) AND (public.has_role(auth.uid(), 'owner')
      OR (public.has_role(auth.uid(), 'seller') AND public.shop_is_open()))
$$;

-- Role lookup no longer auto-assigns; users create or join a shop
CREATE OR REPLACE FUNCTION public.claim_role() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO public.profiles (id, display_name)
  VALUES (auth.uid(), coalesce((SELECT split_part(email, '@', 1) FROM auth.users WHERE id = auth.uid()), ''))
  ON CONFLICT (id) DO NOTHING;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() AND shop_id IS NOT NULL ORDER BY (role = 'owner') DESC LIMIT 1;
  RETURN v_role::text;
END $$;

CREATE OR REPLACE FUNCTION public.create_shop(p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.current_shop_id() IS NOT NULL THEN RAISE EXCEPTION 'You already belong to a shop'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Enter a shop name'; END IF;
  INSERT INTO public.shops (name, owner_id) VALUES (trim(p_name), auth.uid()) RETURNING id INTO v_shop;
  INSERT INTO public.user_roles (user_id, role, shop_id) VALUES (auth.uid(), 'owner', v_shop);
  INSERT INTO public.shop_settings (shop_name, shop_id) VALUES (trim(p_name), v_shop);
  RETURN v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.join_shop(p_code text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.current_shop_id() IS NOT NULL THEN RAISE EXCEPTION 'You already belong to a shop'; END IF;
  SELECT id INTO v_shop FROM public.shops WHERE join_code = upper(trim(p_code));
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Shop code not found'; END IF;
  INSERT INTO public.user_roles (user_id, role, shop_id) VALUES (auth.uid(), 'seller', v_shop);
  RETURN v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_shops() RETURNS TABLE (
  id uuid, name text, owner_email text, join_code text, created_at timestamptz, trial_ends_at timestamptz,
  paid_until timestamptz, suspended boolean, monthly_fee numeric, active boolean, staff_count bigint,
  product_count bigint, sales_30d numeric, last_sale_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  RETURN QUERY SELECT s.id, s.name, (SELECT u.email::text FROM auth.users u WHERE u.id = s.owner_id), s.join_code, s.created_at,
    s.trial_ends_at, s.paid_until, s.suspended, s.monthly_fee, public.shop_active(s.id),
    (SELECT count(*) FROM public.user_roles r WHERE r.shop_id = s.id),
    (SELECT count(*) FROM public.products p WHERE p.shop_id = s.id),
    (SELECT coalesce(sum(x.total), 0) FROM public.sales x WHERE x.shop_id = s.id AND x.created_at > now() - interval '30 days'),
    (SELECT max(x.created_at) FROM public.sales x WHERE x.shop_id = s.id)
  FROM public.shops s ORDER BY s.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_shop(p_shop uuid, p_add_months integer DEFAULT 0, p_suspended boolean DEFAULT NULL, p_extend_trial_days integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  UPDATE public.shops SET
    paid_until = CASE WHEN coalesce(p_add_months, 0) <> 0
      THEN greatest(coalesce(paid_until, now()), now()) + make_interval(months => p_add_months) ELSE paid_until END,
    trial_ends_at = trial_ends_at + make_interval(days => coalesce(p_extend_trial_days, 0)),
    suspended = coalesce(p_suspended, suspended)
  WHERE id = p_shop;
END $$;

-- Checkout / repayment must only touch the caller's shop rows
CREATE OR REPLACE FUNCTION public.checkout_sale_v2(p_items jsonb, p_payment_method text DEFAULT 'cash', p_customer_id uuid DEFAULT NULL, p_client_ref text DEFAULT NULL, p_created_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_id uuid; v_item jsonb; v_product public.products; v_qty integer;
  v_total numeric(12,2) := 0; v_count integer := 0; v_new_qty integer;
  v_conflict boolean := false; v_status text; v_shop uuid := public.current_shop_id();
BEGIN
  IF NOT public.can_operate() THEN RAISE EXCEPTION 'Shop is closed or you are not allowed to sell'; END IF;
  IF p_payment_method NOT IN ('cash','mpesa','credit') THEN RAISE EXCEPTION 'Unknown payment method'; END IF;
  IF p_payment_method = 'credit' AND p_customer_id IS NULL THEN RAISE EXCEPTION 'Pick a customer for a credit sale'; END IF;
  IF p_customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND shop_id = v_shop) THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF p_client_ref IS NOT NULL THEN
    SELECT id INTO v_sale_id FROM public.sales WHERE client_ref = p_client_ref AND shop_id = v_shop;
    IF FOUND THEN RETURN v_sale_id; END IF;
  END IF;
  v_status := CASE p_payment_method WHEN 'cash' THEN 'paid' WHEN 'mpesa' THEN 'pending' ELSE 'unpaid' END;
  INSERT INTO public.sales (total, item_count, payment_method, payment_status, customer_id, created_by, client_ref, created_at, shop_id)
  VALUES (0, 0, p_payment_method, v_status, p_customer_id, auth.uid(), p_client_ref, coalesce(p_created_at, now()), v_shop)
  RETURNING id INTO v_sale_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := greatest(1, (v_item->>'quantity')::int);
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND shop_id = v_shop FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_product.quantity < v_qty THEN v_conflict := true; END IF;
    v_new_qty := greatest(0, v_product.quantity - v_qty);
    INSERT INTO public.sale_items (sale_id, product_id, product_name, barcode, unit_price, quantity, line_total, created_at, shop_id)
    VALUES (v_sale_id, v_product.id, v_product.name, v_product.barcode, v_product.price, v_qty, v_product.price * v_qty, coalesce(p_created_at, now()), v_shop);
    UPDATE public.products SET quantity = v_new_qty, updated_at = now() WHERE id = v_product.id;
    INSERT INTO public.stock_movements (product_id, change, resulting_quantity, reason, sale_id, shop_id)
    VALUES (v_product.id, -v_qty, v_new_qty, 'sale', v_sale_id, v_shop);
    v_total := v_total + v_product.price * v_qty;
    v_count := v_count + v_qty;
  END LOOP;
  UPDATE public.sales SET total = v_total, item_count = v_count, stock_conflict = v_conflict,
    amount_paid = CASE WHEN v_status = 'paid' THEN v_total ELSE 0 END WHERE id = v_sale_id;
  RETURN v_sale_id;
END $$;

CREATE OR REPLACE FUNCTION public.record_repayment(p_customer_id uuid, p_amount numeric, p_method text DEFAULT 'cash')
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_left numeric(12,2) := p_amount; v_sale record; v_due numeric(12,2); v_apply numeric(12,2); v_shop uuid := public.current_shop_id();
BEGIN
  IF NOT public.can_operate() THEN RAISE EXCEPTION 'Shop is closed or you are not allowed to do this'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than 0'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND shop_id = v_shop) THEN RAISE EXCEPTION 'Customer not found'; END IF;
  INSERT INTO public.credit_repayments (customer_id, amount, method, created_by, shop_id) VALUES (p_customer_id, p_amount, coalesce(p_method,'cash'), auth.uid(), v_shop);
  FOR v_sale IN SELECT id, total, amount_paid FROM public.sales
    WHERE customer_id = p_customer_id AND shop_id = v_shop AND payment_method = 'credit' AND payment_status IN ('unpaid','partial')
    ORDER BY created_at ASC FOR UPDATE LOOP
    EXIT WHEN v_left <= 0;
    v_due := v_sale.total - v_sale.amount_paid;
    v_apply := least(v_due, v_left);
    UPDATE public.sales SET amount_paid = amount_paid + v_apply,
      payment_status = CASE WHEN amount_paid + v_apply >= total THEN 'paid' ELSE 'partial' END WHERE id = v_sale.id;
    v_left := v_left - v_apply;
  END LOOP;
  RETURN v_left;
END $$;

-- M-Pesa payments arrive without a session: take the shop from the matched sale
CREATE OR REPLACE FUNCTION public.mpesa_set_shop() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.shop_id IS NULL AND NEW.matched_sale_id IS NOT NULL THEN
    SELECT shop_id INTO NEW.shop_id FROM public.sales WHERE id = NEW.matched_sale_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mpesa_set_shop BEFORE INSERT OR UPDATE ON public.mpesa_payments FOR EACH ROW EXECUTE FUNCTION public.mpesa_set_shop();

-- Correct platform admin email
CREATE OR REPLACE FUNCTION public.grant_platform_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'scalpapaschal@gmail.com' THEN
    INSERT INTO public.platform_admins (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
INSERT INTO public.platform_admins (user_id) SELECT id FROM auth.users WHERE lower(email) = 'scalpapaschal@gmail.com' ON CONFLICT DO NOTHING;

-- ===== fixes after 0006 =====
-- shop_settings was created so that id could only be 1; every shop needs its own row.
ALTER TABLE public.shop_settings DROP CONSTRAINT IF EXISTS shop_settings_id_check;
-- remove the unused starter settings row that belongs to no shop
DELETE FROM public.shop_settings WHERE shop_id IS NULL;

-- ===== migration 0007 =====
-- 0007: remove subscriptions, give the platform admin full access to every shop.
-- Run this in the Supabase dashboard -> SQL Editor (safe to run more than once).

-- 1. Subscriptions off ------------------------------------------------------
-- Every shop is always active. The old trial/paid columns stay in the table but are no longer used.
CREATE OR REPLACE FUNCTION public.shop_active(_shop uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT true
$$;

CREATE OR REPLACE FUNCTION public.can_operate() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'owner')
      OR (public.has_role(auth.uid(), 'seller') AND public.shop_is_open())
$$;

DROP FUNCTION IF EXISTS public.admin_update_shop(uuid, integer, boolean, integer);
DROP FUNCTION IF EXISTS public.admin_list_shops();

-- 2. Platform admin: full access to every shop's data ----------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_repayments, public.shop_settings, public.profiles TO authenticated;

DROP POLICY IF EXISTS "Platform admin full access" ON public.shops;
CREATE POLICY "Platform admin full access" ON public.shops
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['products','sales','sale_items','stock_movements','customers','credit_repayments','expenses','mpesa_payments','shop_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Same shop only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Same shop only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (shop_id = public.current_shop_id() OR public.is_platform_admin()) WITH CHECK (shop_id = public.current_shop_id() OR public.is_platform_admin())', t);
    EXECUTE format('DROP POLICY IF EXISTS "Platform admin full access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Platform admin full access" ON public.%I FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin())', t);
  END LOOP;
END $$;

-- Staff (owners and sellers) and their profiles
DROP POLICY IF EXISTS "Same shop roles" ON public.user_roles;
CREATE POLICY "Same shop roles" ON public.user_roles AS RESTRICTIVE FOR ALL TO authenticated
  USING (user_id = auth.uid() OR shop_id = public.current_shop_id() OR public.is_platform_admin())
  WITH CHECK (shop_id = public.current_shop_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admin full access" ON public.user_roles;
CREATE POLICY "Platform admin full access" ON public.user_roles
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Platform admin full access" ON public.profiles;
CREATE POLICY "Platform admin full access" ON public.profiles
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- 3. Admin dashboard functions (no subscription fields) --------------------
CREATE OR REPLACE FUNCTION public.admin_list_shops() RETURNS TABLE (
  id uuid, name text, owner_email text, join_code text, created_at timestamptz,
  staff_count bigint, product_count bigint, sales_30d numeric, last_sale_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  RETURN QUERY SELECT s.id, s.name, (SELECT u.email::text FROM auth.users u WHERE u.id = s.owner_id), s.join_code, s.created_at,
    (SELECT count(*) FROM public.user_roles r WHERE r.shop_id = s.id),
    (SELECT count(*) FROM public.products p WHERE p.shop_id = s.id),
    (SELECT coalesce(sum(x.total), 0) FROM public.sales x WHERE x.shop_id = s.id AND x.created_at > now() - interval '30 days'),
    (SELECT max(x.created_at) FROM public.sales x WHERE x.shop_id = s.id)
  FROM public.shops s ORDER BY s.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_staff(p_shop uuid) RETURNS TABLE (
  role_id uuid, user_id uuid, email text, display_name text, role text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  RETURN QUERY SELECT r.id, r.user_id, u.email::text, p.display_name, r.role::text
    FROM public.user_roles r
    LEFT JOIN auth.users u ON u.id = r.user_id
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.shop_id = p_shop
    ORDER BY (r.role = 'owner') DESC, u.email;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_list_shops() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_staff(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_list_shops() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_staff(uuid) TO authenticated;

-- ===== migration 0008 =====
-- 0008: easy-to-read shop join codes, e.g. K7M-4PX.
-- Run in the Supabase SQL Editor (safe to run more than once). Existing shops keep their current code.

-- 6 characters in two groups of 3. The alphabet leaves out 0, O, 1, I and L so nobody misreads the code.
-- Characters come from gen_random_uuid(), which is cryptographically random, so codes can't be guessed in order.
CREATE OR REPLACE FUNCTION public.generate_join_code() RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
BEGIN
  LOOP
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    FOR i IN 0..5 LOOP
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
      IF i = 2 THEN v_code := v_code || '-'; END IF;
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.shops WHERE join_code = v_code);
  END LOOP;
  RETURN v_code;
END $$;

ALTER TABLE public.shops ALTER COLUMN join_code SET DEFAULT public.generate_join_code();

-- Staff can type the code in any form: lower case, with or without the dash, with spaces.
CREATE OR REPLACE FUNCTION public.join_shop(p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shop uuid; v_clean text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.current_shop_id() IS NOT NULL THEN RAISE EXCEPTION 'You already belong to a shop'; END IF;
  IF v_clean = '' THEN RAISE EXCEPTION 'Shop code not found'; END IF;
  SELECT id INTO v_shop FROM public.shops WHERE replace(join_code, '-', '') = v_clean;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Shop code not found'; END IF;
  INSERT INTO public.user_roles (user_id, role, shop_id) VALUES (auth.uid(), 'seller', v_shop);
  RETURN v_shop;
END $$;

REVOKE EXECUTE ON FUNCTION public.generate_join_code() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.join_shop(text) TO authenticated;

-- Optional: give existing shops a readable code too (their old code stops working, so tell their owners).
-- UPDATE public.shops SET join_code = public.generate_join_code();
