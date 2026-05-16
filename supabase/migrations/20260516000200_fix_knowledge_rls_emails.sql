-- Drop the old single-email policies
DROP POLICY IF EXISTS "PT admin full access on knowledge docs" ON public.pt_knowledge_documents;
DROP POLICY IF EXISTS "PT admin full access on knowledge chunks" ON public.pt_knowledge_chunks;

-- Recreate with the same admin email set used everywhere else in the project
CREATE POLICY "PT admin full access on knowledge docs"
  ON public.pt_knowledge_documents FOR ALL
  USING (
    lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY "PT admin full access on knowledge chunks"
  ON public.pt_knowledge_chunks FOR ALL
  USING (
    lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    lower(auth.email()) IN ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
