CREATE POLICY "Anyone can read listings"
ON public.listings
FOR SELECT
TO anon, authenticated
USING (true);