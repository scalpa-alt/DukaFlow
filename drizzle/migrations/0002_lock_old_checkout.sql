REVOKE EXECUTE ON FUNCTION public.checkout_sale(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_sale_v2(jsonb, text, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_repayment(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_role() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.checkout_sale_v2(jsonb, text, uuid, text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_repayment(uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_role() FROM anon;