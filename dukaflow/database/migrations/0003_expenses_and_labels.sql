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