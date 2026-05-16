DROP POLICY IF EXISTS "PT admin upload knowledge" ON storage.objects;
DROP POLICY IF EXISTS "PT admin read knowledge" ON storage.objects;
DROP POLICY IF EXISTS "PT admin delete knowledge" ON storage.objects;

CREATE POLICY "PT admin upload knowledge"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'pt-knowledge-docs'
    AND lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
  );

CREATE POLICY "PT admin read knowledge"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'pt-knowledge-docs'
    AND lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
  );

CREATE POLICY "PT admin update knowledge"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'pt-knowledge-docs'
    AND lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
  );

CREATE POLICY "PT admin delete knowledge"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'pt-knowledge-docs'
    AND lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
  );
