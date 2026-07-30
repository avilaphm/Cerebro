create index if not exists pt_movement_assessment_invites_appointment_idx
  on public.pt_movement_assessment_invites (appointment_id)
  where appointment_id is not null;

create index if not exists pt_movement_assessment_invites_created_by_idx
  on public.pt_movement_assessment_invites (created_by)
  where created_by is not null;

drop policy if exists "Admins manage movement assessment invites"
  on public.pt_movement_assessment_invites;

create policy "Admins manage movement assessment invites"
  on public.pt_movement_assessment_invites
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'admin'
    )
  );
