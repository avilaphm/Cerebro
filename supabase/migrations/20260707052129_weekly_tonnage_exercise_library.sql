-- Weekly Tonnage Phase 1: classify once, compute forever.
-- This table is separate from pt_exercises on purpose: pt_exercises owns coach
-- programming/video cards, while exercise_library owns deterministic tonnage tags.

create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  canonical_key text not null,
  aliases jsonb not null default '[]'::jsonb,
  source_exercise_id uuid references public.pt_exercises(id) on delete set null,
  pattern text not null default 'other' check (
    pattern in ('push', 'pull', 'hinge', 'squat', 'carry', 'core', 'other')
  ),
  plane text check (plane in ('vertical', 'horizontal')),
  primary_muscle text not null default 'other',
  secondary_muscles jsonb not null default '[]'::jsonb,
  load_type text not null default 'external' check (
    load_type in ('external', 'bodyweight', 'hybrid')
  ),
  bodyweight_factor numeric check (
    bodyweight_factor is null or (bodyweight_factor >= 0 and bodyweight_factor <= 2)
  ),
  tonnage_mode text not null default 'reps_load' check (
    tonnage_mode in ('reps_load', 'time_based', 'carry', 'isometric')
  ),
  classified_by text not null default 'ai' check (classified_by in ('ai', 'coach')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  locked boolean not null default false,
  needs_review boolean not null default false,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_classified_at timestamptz
);

create unique index if not exists exercise_library_canonical_key_idx
  on public.exercise_library (canonical_key);

create index if not exists exercise_library_pattern_idx
  on public.exercise_library (pattern);

create index if not exists exercise_library_needs_review_idx
  on public.exercise_library (needs_review)
  where needs_review = true;

create index if not exists exercise_library_source_exercise_idx
  on public.exercise_library (source_exercise_id)
  where source_exercise_id is not null;

alter table public.exercise_library enable row level security;

grant select, insert, update, delete on public.exercise_library to authenticated;
grant select, insert, update, delete on public.exercise_library to service_role;

drop policy if exists "service role full exercise library" on public.exercise_library;
create policy "service role full exercise library"
  on public.exercise_library for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "pt admins full exercise library" on public.exercise_library;
create policy "pt admins full exercise library"
  on public.exercise_library for all
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
      and p.role = 'admin'
    )
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
      and p.role = 'admin'
    )
  );
