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
