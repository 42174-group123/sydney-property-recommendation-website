DROP POLICY IF EXISTS "authenticated can insert listings" ON public.listings;

CREATE POLICY "hosts can create listings"
ON public.listings
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.hosts
    WHERE hosts.user_id = auth.uid()
  )
);