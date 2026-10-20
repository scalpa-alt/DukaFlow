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