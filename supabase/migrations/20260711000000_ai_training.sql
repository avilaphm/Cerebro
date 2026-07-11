-- AI Training: coach-onboarding answers + completion status.
-- The onboarding tab writes one row per question here; on completion the answers
-- are compiled into a single "coach_training_profile" doc in pt_knowledge_documents
-- (existing table) that programme generation reads.
--
-- Single-tenant for now (RLS pinned to Pedro, matching the rest of the app). Shaped
-- so a `coach_id` column + per-coach uniqueness/RLS drops in later with no rework.

create table if not exists public.pt_ai_training_answers (
  id uuid primary key default gen_random_uuid(),
  section text not null,                 -- 'A'..'F' (question section)
  question_key text not null unique,     -- stable id per question; becomes unique(coach_id, question_key) when multi-tenant
  answer_text text,
  updated_at timestamptz not null default now()
);

alter table public.pt_ai_training_answers enable row level security;

drop policy if exists "PT admin full access on ai training answers" on public.pt_ai_training_answers;
create policy "PT admin full access on ai training answers"
  on public.pt_ai_training_answers for all
  using (auth.email() = 'avila.phm@gmail.com')
  with check (auth.email() = 'avila.phm@gmail.com');

-- Single-row completion signal (one row per coach once multi-tenant).
create table if not exists public.pt_ai_training_status (
  id int primary key default 1,
  completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pt_ai_training_status_singleton check (id = 1)
);

alter table public.pt_ai_training_status enable row level security;

drop policy if exists "PT admin full access on ai training status" on public.pt_ai_training_status;
create policy "PT admin full access on ai training status"
  on public.pt_ai_training_status for all
  using (auth.email() = 'avila.phm@gmail.com')
  with check (auth.email() = 'avila.phm@gmail.com');

insert into public.pt_ai_training_status (id) values (1) on conflict (id) do nothing;
