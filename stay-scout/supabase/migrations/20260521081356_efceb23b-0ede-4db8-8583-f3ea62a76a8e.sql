-- Replace the permissive INSERT policy with an ownership-scoped one.
DROP POLICY IF EXISTS "authenticated can upload listing images" ON storage.objects;

CREATE POLICY "authenticated can upload own listing images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'listing-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Add a DELETE policy scoped to the uploader's own folder.
DROP POLICY IF EXISTS "authenticated can delete own listing images" ON storage.objects;

CREATE POLICY "authenticated can delete own listing images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'listing-images'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[2] = auth.uid()::text
);