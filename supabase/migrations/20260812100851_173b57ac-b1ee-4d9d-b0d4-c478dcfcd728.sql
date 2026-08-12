CREATE POLICY "entry backgrounds service only"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'tenant-entry-backgrounds')
WITH CHECK (bucket_id = 'tenant-entry-backgrounds');