-- 0010: the platform admin can block a shop (and unblock it later).
-- A blocked shop's owner and staff can still sign in, but see a "blocked" screen and the database
-- returns none of the shop's data to them. Safe to run more than once.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS blocked_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
-- (the existing "suspended" column is the on/off flag)

-- The shop a person belongs to, blocked or not
CREATE OR REPLACE FUNCTION public.user_shop_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT shop_id FROM public.user_roles WHERE user_id = auth.uid() AND shop_id IS NOT NULL ORDER BY (role = 'owner') DESC LIMIT 1
$$;

-- Row Level Security uses this one. For a blocked shop it returns nothing, so every shop table
-- (products, sales, customers, settings, logos...) becomes empty and read-only for its people.
CREATE OR REPLACE FUNCTION public.current_shop_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.shops s WHERE s.id = public.user_shop_id() AND NOT s.suspended
$$;

CREATE OR REPLACE FUNCTION public.shop_active(_shop uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT NOT suspended FROM public.shops WHERE id = _shop), false)
$$;

CREATE OR REPLACE FUNCTION public.can_operate() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.shop_active(public.user_shop_id())
     AND (public.has_role(auth.uid(), 'owner') OR (public.has_role(auth.uid(), 'seller') AND public.shop_is_open()))
$$;

-- What the app asks after sign-in: is my shop blocked?
CREATE OR REPLACE FUNCTION public.my_shop_status() RETURNS TABLE (blocked boolean, reason text, shop_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.suspended, s.blocked_reason, s.name FROM public.shops s WHERE s.id = public.user_shop_id()
$$;

-- Create / join use the unfiltered lookup, so a blocked person cannot slip into a second shop.
CREATE OR REPLACE FUNCTION public.create_shop(p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shop uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.user_shop_id() IS NOT NULL THEN RAISE EXCEPTION 'You already belong to a shop'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Enter a shop name'; END IF;
  INSERT INTO public.shops (name, owner_id) VALUES (trim(p_name), auth.uid()) RETURNING id INTO v_shop;
  INSERT INTO public.user_roles (user_id, role, shop_id) VALUES (auth.uid(), 'owner', v_shop);
  INSERT INTO public.shop_settings (shop_name, shop_id) VALUES (trim(p_name), v_shop);
  RETURN v_shop;
END $$;

CREATE OR REPLACE FUNCTION public.join_shop(p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_shop uuid; v_susp boolean; v_clean text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF public.user_shop_id() IS NOT NULL THEN RAISE EXCEPTION 'You already belong to a shop'; END IF;
  IF v_clean = '' THEN RAISE EXCEPTION 'Shop code not found'; END IF;
  SELECT id, suspended INTO v_shop, v_susp FROM public.shops WHERE replace(join_code, '-', '') = v_clean;
  IF v_shop IS NULL THEN RAISE EXCEPTION 'Shop code not found'; END IF;
  IF v_susp THEN RAISE EXCEPTION 'This shop has been blocked by the administrator'; END IF;
  INSERT INTO public.user_roles (user_id, role, shop_id) VALUES (auth.uid(), 'seller', v_shop);
  RETURN v_shop;
END $$;

-- Platform admin: block or unblock a shop
CREATE OR REPLACE FUNCTION public.admin_set_shop_blocked(p_shop uuid, p_blocked boolean, p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  UPDATE public.shops
     SET suspended = p_blocked,
         blocked_reason = CASE WHEN p_blocked THEN coalesce(trim(p_reason), '') ELSE '' END,
         blocked_at = CASE WHEN p_blocked THEN now() ELSE NULL END
   WHERE id = p_shop;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shop not found'; END IF;
END $$;

-- The list now says which shops are blocked
DROP FUNCTION IF EXISTS public.admin_list_shops();
CREATE OR REPLACE FUNCTION public.admin_list_shops() RETURNS TABLE (
  id uuid, name text, owner_email text, join_code text, created_at timestamptz,
  staff_count bigint, product_count bigint, sales_30d numeric, last_sale_at timestamptz,
  blocked boolean, blocked_reason text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform admin only'; END IF;
  RETURN QUERY SELECT s.id, s.name, (SELECT u.email::text FROM auth.users u WHERE u.id = s.owner_id), s.join_code, s.created_at,
    (SELECT count(*) FROM public.user_roles r WHERE r.shop_id = s.id),
    (SELECT count(*) FROM public.products p WHERE p.shop_id = s.id),
    (SELECT coalesce(sum(x.total), 0) FROM public.sales x WHERE x.shop_id = s.id AND x.created_at > now() - interval '30 days'),
    (SELECT max(x.created_at) FROM public.sales x WHERE x.shop_id = s.id),
    s.suspended, s.blocked_reason
  FROM public.shops s ORDER BY s.created_at DESC;
END $$;

REVOKE EXECUTE ON FUNCTION public.user_shop_id(), public.my_shop_status(), public.admin_set_shop_blocked(uuid, boolean, text), public.admin_list_shops() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.user_shop_id(), public.my_shop_status(), public.admin_set_shop_blocked(uuid, boolean, text), public.admin_list_shops() TO authenticated;
