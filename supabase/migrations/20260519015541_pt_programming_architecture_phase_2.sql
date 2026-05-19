-- PT Programming System Phase 2
-- Adds orchestration, document, review, 1RM, and nutrition-sync tables around
-- the existing PT client brain and programme assignment architecture.

create table if not exists public.pt_client_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  document_type text not null check (document_type in ('intake', 'movement_assessment', 'profile', 'other')),
  title text not null,
  storage_path text,
  content_text text,
  parsed_summary jsonb not null default '{}'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded' check (status in ('uploaded', 'parsed', 'analysed', 'archived')),
  uploaded_by uuid references auth.users(id) on delete set null
);

create index if not exists pt_client_documents_client_type_idx
  on public.pt_client_documents (client_id, document_type, created_at desc);

create index if not exists pt_client_documents_status_idx
  on public.pt_client_documents (status);

alter table public.pt_clients
  add column if not exists intake_document_id uuid references public.pt_client_documents(id) on delete set null,
  add column if not exists assessment_document_id uuid references public.pt_client_documents(id) on delete set null;

create index if not exists pt_clients_intake_document_idx
  on public.pt_clients (intake_document_id);

create index if not exists pt_clients_assessment_document_idx
  on public.pt_clients (assessment_document_id);

create table if not exists public.pt_program_generation_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  intake_document_id uuid references public.pt_client_documents(id) on delete set null,
  assessment_document_id uuid references public.pt_client_documents(id) on delete set null,
  assignment_id uuid references public.pt_program_assignments(id) on delete set null,
  task_type text not null default 'full_program',
  phase_type text,
  client_goal text,
  current_command text,
  status text not null default 'draft' check (status in ('draft', 'running', 'needs_review', 'approved', 'saved', 'failed', 'archived')),
  coaching_reasoning jsonb not null default '{}'::jsonb,
  phase_roadmap jsonb not null default '{}'::jsonb,
  programme_draft jsonb not null default '{}'::jsonb,
  nutrition_draft jsonb not null default '{}'::jsonb,
  validation_summary jsonb not null default '{}'::jsonb,
  failure_reason text,
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists pt_program_generation_runs_client_idx
  on public.pt_program_generation_runs (client_id, created_at desc);

create index if not exists pt_program_generation_runs_status_idx
  on public.pt_program_generation_runs (status, created_at desc);

create index if not exists pt_program_generation_runs_assignment_idx
  on public.pt_program_generation_runs (assignment_id);

create table if not exists public.pt_program_generation_steps (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid not null references public.pt_program_generation_runs(id) on delete cascade,
  step_order int not null,
  command_name text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  validation_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  failure_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  unique (run_id, step_order)
);

create index if not exists pt_program_generation_steps_run_idx
  on public.pt_program_generation_steps (run_id, step_order);

create index if not exists pt_program_generation_steps_command_idx
  on public.pt_program_generation_steps (command_name);

create table if not exists public.pt_knowledge_retrieval_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid references public.pt_program_generation_runs(id) on delete cascade,
  step_id uuid references public.pt_program_generation_steps(id) on delete set null,
  task_type text not null,
  phase_type text,
  client_goal text,
  question_or_decision text not null,
  excerpts jsonb not null default '[]'::jsonb,
  applied_rules jsonb not null default '[]'::jsonb,
  referenced_documents jsonb not null default '[]'::jsonb,
  confidence_score numeric check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  low_confidence boolean not null default false
);

create index if not exists pt_knowledge_retrieval_logs_run_idx
  on public.pt_knowledge_retrieval_logs (run_id, created_at desc);

create index if not exists pt_knowledge_retrieval_logs_step_idx
  on public.pt_knowledge_retrieval_logs (step_id);

create table if not exists public.pt_client_1rm_tests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  assignment_id uuid references public.pt_program_assignments(id) on delete set null,
  generation_run_id uuid references public.pt_program_generation_runs(id) on delete set null,
  test_type text not null default 'baseline' check (test_type in ('baseline', 'retest', 'manual')),
  status text not null default 'planned' check (status in ('planned', 'completed', 'archived')),
  tested_at timestamptz,
  notes text
);

create index if not exists pt_client_1rm_tests_client_idx
  on public.pt_client_1rm_tests (client_id, created_at desc);

create index if not exists pt_client_1rm_tests_assignment_idx
  on public.pt_client_1rm_tests (assignment_id);

create table if not exists public.pt_client_1rm_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  test_id uuid not null references public.pt_client_1rm_tests(id) on delete cascade,
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  exercise_id uuid references public.pt_exercises(id) on delete set null,
  exercise_name text not null,
  result_type text not null default 'actual' check (result_type in ('actual', 'estimated', 'rpe_placeholder')),
  load_kg numeric,
  reps numeric,
  rpe numeric,
  estimated_1rm_kg numeric,
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  notes text
);

create index if not exists pt_client_1rm_results_test_idx
  on public.pt_client_1rm_results (test_id);

create index if not exists pt_client_1rm_results_client_exercise_idx
  on public.pt_client_1rm_results (client_id, exercise_name, created_at desc);

create table if not exists public.pt_phase_nutrition (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  assignment_id uuid references public.pt_program_assignments(id) on delete cascade,
  generation_run_id uuid references public.pt_program_generation_runs(id) on delete set null,
  phase_index int not null,
  phase_title text not null,
  phase_type text not null,
  training_context jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '{}'::jsonb,
  review_status text not null default 'draft' check (review_status in ('draft', 'needs_review', 'approved', 'archived')),
  unique (assignment_id, phase_index)
);

create index if not exists pt_phase_nutrition_client_idx
  on public.pt_phase_nutrition (client_id, created_at desc);

create index if not exists pt_phase_nutrition_assignment_idx
  on public.pt_phase_nutrition (assignment_id, phase_index);

create table if not exists public.pt_program_review_outputs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid references public.pt_program_generation_runs(id) on delete cascade,
  assignment_id uuid references public.pt_program_assignments(id) on delete cascade,
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  review_type text not null check (review_type in ('program', 'nutrition', 'system', 'full')),
  status text not null check (status in ('passed', 'failed', 'needs_review')),
  findings jsonb not null default '[]'::jsonb,
  hard_rule_failures jsonb not null default '[]'::jsonb,
  repaired_output jsonb not null default '{}'::jsonb,
  reviewer_notes text
);

create index if not exists pt_program_review_outputs_run_idx
  on public.pt_program_review_outputs (run_id, created_at desc);

create index if not exists pt_program_review_outputs_client_idx
  on public.pt_program_review_outputs (client_id, created_at desc);

create table if not exists public.pt_extra_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  assignment_id uuid references public.pt_program_assignments(id) on delete cascade,
  generation_run_id uuid references public.pt_program_generation_runs(id) on delete set null,
  phase_index int,
  session_type text not null check (session_type in ('mobility', 'recovery', 'zone_2', 'accessory', 'conditioning', 'sport_specific', 'other')),
  title text not null,
  session jsonb not null default '{}'::jsonb,
  affects_main_progression boolean not null default false check (affects_main_progression = false),
  review_status text not null default 'draft' check (review_status in ('draft', 'approved', 'archived')),
  scheduled_for date
);

create index if not exists pt_extra_sessions_client_idx
  on public.pt_extra_sessions (client_id, created_at desc);

create index if not exists pt_extra_sessions_assignment_idx
  on public.pt_extra_sessions (assignment_id, phase_index);

alter table public.pt_program_assignments
  add column if not exists generation_run_id uuid references public.pt_program_generation_runs(id) on delete set null,
  add column if not exists coach_review_status text not null default 'approved' check (coach_review_status in ('draft', 'needs_review', 'approved', 'changes_requested')),
  add column if not exists validation_summary jsonb not null default '{}'::jsonb,
  add column if not exists nutrition_sync jsonb not null default '{}'::jsonb,
  add column if not exists source_document_ids uuid[] not null default '{}'::uuid[];

create index if not exists pt_program_assignments_generation_run_idx
  on public.pt_program_assignments (generation_run_id);

create index if not exists pt_program_assignments_review_status_idx
  on public.pt_program_assignments (coach_review_status);

alter table public.pt_program_templates
  add column if not exists generation_run_id uuid references public.pt_program_generation_runs(id) on delete set null,
  add column if not exists validation_summary jsonb not null default '{}'::jsonb;

create index if not exists pt_program_templates_generation_run_idx
  on public.pt_program_templates (generation_run_id);

alter table public.pt_client_exercise_doc
  add column if not exists movement_assessment_summary jsonb not null default '{}'::jsonb,
  add column if not exists progression_strategy jsonb not null default '{}'::jsonb;

alter table public.pt_client_nutrition_doc
  add column if not exists phase_nutrition_strategy jsonb not null default '{}'::jsonb;

alter table public.pt_client_brain
  add column if not exists coaching_reasoning jsonb not null default '{}'::jsonb,
  add column if not exists important_decisions jsonb not null default '[]'::jsonb;

alter table public.pt_client_documents enable row level security;
alter table public.pt_program_generation_runs enable row level security;
alter table public.pt_program_generation_steps enable row level security;
alter table public.pt_knowledge_retrieval_logs enable row level security;
alter table public.pt_client_1rm_tests enable row level security;
alter table public.pt_client_1rm_results enable row level security;
alter table public.pt_phase_nutrition enable row level security;
alter table public.pt_program_review_outputs enable row level security;
alter table public.pt_extra_sessions enable row level security;

create policy "service role full client documents"
  on public.pt_client_documents for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full client documents"
  on public.pt_client_documents for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "service role full generation runs"
  on public.pt_program_generation_runs for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full generation runs"
  on public.pt_program_generation_runs for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "service role full generation steps"
  on public.pt_program_generation_steps for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full generation steps"
  on public.pt_program_generation_steps for all
  to authenticated
  using (
    exists (
      select 1
      from public.pt_program_generation_runs r
      where r.id = pt_program_generation_steps.run_id
      and (
        lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
        or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
      )
    )
  )
  with check (
    exists (
      select 1
      from public.pt_program_generation_runs r
      where r.id = pt_program_generation_steps.run_id
      and (
        lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
        or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
      )
    )
  );

create policy "service role full retrieval logs"
  on public.pt_knowledge_retrieval_logs for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full retrieval logs"
  on public.pt_knowledge_retrieval_logs for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "service role full 1rm tests"
  on public.pt_client_1rm_tests for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full 1rm tests"
  on public.pt_client_1rm_tests for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read own 1rm tests"
  on public.pt_client_1rm_tests for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_client_1rm_tests.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "service role full 1rm results"
  on public.pt_client_1rm_results for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full 1rm results"
  on public.pt_client_1rm_results for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read own 1rm results"
  on public.pt_client_1rm_results for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_client_1rm_results.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "service role full phase nutrition"
  on public.pt_phase_nutrition for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full phase nutrition"
  on public.pt_phase_nutrition for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read approved phase nutrition"
  on public.pt_phase_nutrition for select
  to authenticated
  using (
    review_status = 'approved'
    and exists (
      select 1 from public.pt_clients c
      where c.id = pt_phase_nutrition.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "service role full program review outputs"
  on public.pt_program_review_outputs for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full program review outputs"
  on public.pt_program_review_outputs for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "service role full extra sessions"
  on public.pt_extra_sessions for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full extra sessions"
  on public.pt_extra_sessions for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read approved extra sessions"
  on public.pt_extra_sessions for select
  to authenticated
  using (
    review_status = 'approved'
    and exists (
      select 1 from public.pt_clients c
      where c.id = pt_extra_sessions.client_id
      and c.user_id = (select auth.uid())
    )
  );

create or replace function public.create_client_brain_docs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pt_client_brain (client_id) values (new.id) on conflict (client_id) do nothing;
  insert into public.pt_client_nutrition_doc (client_id) values (new.id) on conflict (client_id) do nothing;
  insert into public.pt_client_exercise_doc (client_id) values (new.id) on conflict (client_id) do nothing;
  insert into public.pt_client_lifestyle_doc (client_id) values (new.id) on conflict (client_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_client_brain_docs() from anon, authenticated, public;

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count int default 6,
  match_threshold float default 0.4
)
returns table (
  chunk_text text,
  document_title text,
  similarity float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.chunk_text,
    d.title as document_title,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.pt_knowledge_chunks c
  join public.pt_knowledge_documents d on d.id = c.document_id
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.match_knowledge_chunks(extensions.vector(1536), int, float) from anon, authenticated, public;
grant execute on function public.match_knowledge_chunks(extensions.vector(1536), int, float) to service_role;
