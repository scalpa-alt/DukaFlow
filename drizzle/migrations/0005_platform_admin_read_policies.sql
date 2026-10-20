CREATE POLICY "Platform admins read roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "Platform admins read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_platform_admin());