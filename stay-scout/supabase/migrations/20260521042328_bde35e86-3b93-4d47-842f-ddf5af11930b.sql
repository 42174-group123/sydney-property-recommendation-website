ALTER TABLE public.hosts ALTER COLUMN host_since DROP NOT NULL;
ALTER TABLE public.hosts ALTER COLUMN host_since DROP DEFAULT;
ALTER TABLE public.hosts ADD COLUMN IF NOT EXISTS published_listings bigint[] NOT NULL DEFAULT '{}'::bigint[];
CREATE POLICY "hosts can delete their own listings"
ON public.listings
FOR DELETE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.hosts WHERE hosts.user_id = auth.uid() AND listings.id = ANY(hosts.published_listings)));