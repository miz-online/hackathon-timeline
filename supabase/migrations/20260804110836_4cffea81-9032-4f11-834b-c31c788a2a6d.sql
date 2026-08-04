DROP POLICY IF EXISTS "tenant buckets service role only" ON storage.objects;

CREATE POLICY "tenant buckets service role only"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id IN ('tenant-logos', 'tenant-ads'))
WITH CHECK (bucket_id IN ('tenant-logos', 'tenant-ads'));