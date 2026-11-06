-- Shop details used on receipts, and a place to keep each shop's logo.
-- Safe to run more than once.

ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS owner_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS receipt_footer text NOT NULL DEFAULT 'Thank you for shopping with us!';

-- Logos live in a public bucket (a receipt only needs to show the picture).
-- Each shop writes only inside its own folder: <shop id>/<file>.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shop-logos', 'shop-logos', true, 1048576, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DROP POLICY IF EXISTS "Shop logos are public" ON storage.objects;
CREATE POLICY "Shop logos are public" ON storage.objects
  FOR SELECT USING (bucket_id = 'shop-logos');

DROP POLICY IF EXISTS "Owner adds own shop logo" ON storage.objects;
CREATE POLICY "Owner adds own shop logo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
    AND (public.has_role(auth.uid(), 'owner') OR public.is_platform_admin())
  );

DROP POLICY IF EXISTS "Owner changes own shop logo" ON storage.objects;
CREATE POLICY "Owner changes own shop logo" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
    AND (public.has_role(auth.uid(), 'owner') OR public.is_platform_admin())
  );

DROP POLICY IF EXISTS "Owner removes own shop logo" ON storage.objects;
CREATE POLICY "Owner removes own shop logo" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
    AND (public.has_role(auth.uid(), 'owner') OR public.is_platform_admin())
  );
