
-- hosts table
CREATE TABLE public.hosts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  host_since timestamptz NOT NULL DEFAULT now(),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hosts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hosts readable by anyone authenticated"
ON public.hosts FOR SELECT TO authenticated USING (true);

CREATE POLICY "users can insert their own host row"
ON public.hosts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update their own host row"
ON public.hosts FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- allow authenticated users to insert listings
CREATE POLICY "authenticated can insert listings"
ON public.listings FOR INSERT TO authenticated WITH CHECK (true);

-- storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "listing images public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'listing-images');

CREATE POLICY "authenticated can upload listing images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'listing-images');

CREATE POLICY "authenticated can update own listing images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'listing-images' AND owner = auth.uid());
