-- Split the FOR ALL admin policy on pt_messages so we can constrain INSERT
-- to sender='pt'. SELECT/UPDATE/DELETE behaviour stays identical so the
-- existing "mark as read" UPDATE on client-sent messages keeps working.

DROP POLICY IF EXISTS "pt admins full messages" ON public.pt_messages;

CREATE POLICY "pt admins select messages"
  ON public.pt_messages
  FOR SELECT
  TO authenticated
  USING (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

CREATE POLICY "pt admins insert messages"
  ON public.pt_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
      OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
    AND sender = 'pt'
  );

CREATE POLICY "pt admins update messages"
  ON public.pt_messages
  FOR UPDATE
  TO authenticated
  USING (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  WITH CHECK (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

CREATE POLICY "pt admins delete messages"
  ON public.pt_messages
  FOR DELETE
  TO authenticated
  USING (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
