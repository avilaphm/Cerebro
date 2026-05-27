-- Keep draft/coach-review programmes hidden from clients until Pedro publishes.
-- In the current data model, `pt_program_assignments.status = 'active'` is the
-- published/visible state. Drafts remain coach-only.

drop policy if exists "clients read assigned programmes" on public.pt_program_assignments;

create policy "clients read active approved programmes"
  on public.pt_program_assignments for select
  to authenticated
  using (
    status = 'active'
    and coach_review_status = 'approved'
    and exists (
      select 1
      from public.pt_clients c
      where c.id = pt_program_assignments.client_id
      and c.user_id = (select auth.uid())
    )
  );

create table if not exists public.pt_programme_staples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid references public.pt_clients(id) on delete cascade,
  generation_run_id uuid references public.pt_program_generation_runs(id) on delete set null,
  phase_type text not null,
  exercise_name text not null,
  reason text,
  muscles text[] not null default '{}',
  source text not null default 'exercise_intelligence' check (source in ('standard', 'exercise_intelligence', 'coach')),
  unique (client_id, phase_type, exercise_name)
);

create index if not exists pt_programme_staples_client_phase_idx
  on public.pt_programme_staples (client_id, phase_type);

alter table public.pt_programme_staples enable row level security;

create policy "service role full programme staples"
  on public.pt_programme_staples for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full programme staples"
  on public.pt_programme_staples for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
