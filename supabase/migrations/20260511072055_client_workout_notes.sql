alter table public.pt_client_notes
  add column if not exists context jsonb not null default '{}'::jsonb;

create policy "clients insert own workout notes"
  on public.pt_client_notes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_client_notes.client_id
      and c.user_id = (select auth.uid())
    )
    and source_message_id is null
    and coalesce(context ->> 'source', '') = 'workout_section'
  );
