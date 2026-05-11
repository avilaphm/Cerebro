-- Allow Pedro's production Cerebro login to manage the PT dashboard.

alter policy "pt admins full clients"
  on public.pt_clients
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

alter policy "pt admins full exercises"
  on public.pt_exercises
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

alter policy "pt admins full templates"
  on public.pt_program_templates
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

alter policy "pt admins full assignments"
  on public.pt_program_assignments
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

alter policy "pt admins full workout logs"
  on public.pt_workout_logs
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

alter policy "pt admins full set logs"
  on public.pt_set_logs
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

alter policy "pt admins full events"
  on public.pt_events
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
