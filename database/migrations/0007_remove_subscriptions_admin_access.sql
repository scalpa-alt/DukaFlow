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
