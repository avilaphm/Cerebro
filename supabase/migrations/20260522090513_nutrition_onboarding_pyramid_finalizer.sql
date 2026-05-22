-- Nutrition onboarding, Helms/Pyramid finalizer audit data, and weekly
-- client-brain reports.

alter table public.pt_clients
  add column if not exists height_cm numeric,
  add column if not exists current_weight_kg numeric,
  add column if not exists activity_level int check (activity_level is null or activity_level between 1 and 5),
  add column if not exists activity_tag text check (
    activity_tag is null
    or activity_tag in ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'athlete_level')
  ),
  add column if not exists nutrition_onboarding_completed_at timestamptz;

create index if not exists pt_clients_nutrition_onboarding_idx
  on public.pt_clients (nutrition_onboarding_completed_at)
  where nutrition_onboarding_completed_at is null;

alter table public.pt_client_nutrition_doc
  add column if not exists pyramid_finalizer jsonb not null default '{}'::jsonb,
  add column if not exists adherence_metrics jsonb not null default '{}'::jsonb;

alter table public.pt_client_exercise_doc
  add column if not exists training_metrics jsonb not null default '{}'::jsonb;

alter table public.pt_phase_nutrition
  add column if not exists finalizer_notes jsonb not null default '{}'::jsonb;

create table if not exists public.pt_client_brain_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  report_type text not null default 'weekly' check (report_type in ('weekly')),
  source_snapshot jsonb not null default '{}'::jsonb,
  coach_summary text,
  client_summary text,
  nutrition_summary text,
  training_summary text,
  flags jsonb not null default '[]'::jsonb,
  applied_to_brain boolean not null default false,
  unique (client_id, week_start, report_type)
);

create index if not exists pt_client_brain_reports_client_week_idx
  on public.pt_client_brain_reports (client_id, week_start desc);

alter table public.pt_client_brain_reports enable row level security;

create policy "service role full client brain reports"
  on public.pt_client_brain_reports for all
  to service_role
  using (true)
  with check (true);

create policy "pt admins full client brain reports"
  on public.pt_client_brain_reports for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = any (array['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read own client brain reports"
  on public.pt_client_brain_reports for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_client_brain_reports.client_id
      and c.user_id = (select auth.uid())
    )
  );

create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('weekly-client-brain-review')
where exists (select 1 from cron.job where jobname = 'weekly-client-brain-review');

select cron.schedule(
  'weekly-client-brain-review',
  '0 20 * * 0',
  $$
    select net.http_post(
      url := 'https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/weekly-client-brain-review',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer cerebro-cron-2026"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);
