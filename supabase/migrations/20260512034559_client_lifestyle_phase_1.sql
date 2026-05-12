-- Client Lifestyle Coaching OS - Phase 1
-- Client 360, weekly reset, baseline metrics, goals, and coaching tasks.

alter table public.pt_clients
  add column if not exists lifestyle_context text,
  add column if not exists regular_training_slot text,
  add column if not exists coaching_focus text,
  add column if not exists event_goal text;

create table if not exists public.pt_weekly_checkins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  week_start date not null,
  availability text,
  golf_days text,
  run_days text,
  energy int check (energy between 1 and 5),
  soreness int check (soreness between 1 and 5),
  sleep int check (sleep between 1 and 5),
  stress int check (stress between 1 and 5),
  travel text,
  injuries text,
  nutrition_focus text,
  nutrition_obstacles text,
  client_focus text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed', 'archived'))
);

create index if not exists pt_weekly_checkins_client_week_idx
  on public.pt_weekly_checkins (client_id, week_start desc);

create table if not exists public.pt_client_metrics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  measured_at date not null default current_date,
  weight_kg numeric,
  waist_cm numeric,
  body_fat_pct numeric,
  muscle_mass_kg numeric,
  source text not null default 'manual' check (source in ('manual', 'scale', 'coach')),
  notes text
);

create index if not exists pt_client_metrics_client_measured_idx
  on public.pt_client_metrics (client_id, measured_at desc, created_at desc);

create table if not exists public.pt_client_goals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  goal_type text not null default 'general',
  title text not null,
  target_value numeric,
  current_value numeric,
  unit text,
  target_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  notes text
);

create index if not exists pt_client_goals_client_status_idx
  on public.pt_client_goals (client_id, status, created_at desc);

create table if not exists public.pt_coaching_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  title text not null,
  details text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'done', 'archived')),
  due_at timestamptz,
  completed_at timestamptz
);

create index if not exists pt_coaching_tasks_client_status_idx
  on public.pt_coaching_tasks (client_id, status, created_at desc);

alter table public.pt_weekly_checkins enable row level security;
alter table public.pt_client_metrics enable row level security;
alter table public.pt_client_goals enable row level security;
alter table public.pt_coaching_tasks enable row level security;

drop policy if exists "pt admins full weekly checkins" on public.pt_weekly_checkins;
drop policy if exists "clients read own weekly checkins" on public.pt_weekly_checkins;
drop policy if exists "clients insert own weekly checkins" on public.pt_weekly_checkins;
drop policy if exists "read weekly checkins" on public.pt_weekly_checkins;
drop policy if exists "insert weekly checkins" on public.pt_weekly_checkins;
drop policy if exists "pt admins update weekly checkins" on public.pt_weekly_checkins;
drop policy if exists "pt admins delete weekly checkins" on public.pt_weekly_checkins;

create policy "read weekly checkins"
  on public.pt_weekly_checkins for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_weekly_checkins.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "insert weekly checkins"
  on public.pt_weekly_checkins for insert
  to authenticated
  with check (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_weekly_checkins.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update weekly checkins"
  on public.pt_weekly_checkins for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete weekly checkins"
  on public.pt_weekly_checkins for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

drop policy if exists "pt admins full client metrics" on public.pt_client_metrics;
drop policy if exists "clients read own client metrics" on public.pt_client_metrics;
drop policy if exists "clients insert own client metrics" on public.pt_client_metrics;
drop policy if exists "read client metrics" on public.pt_client_metrics;
drop policy if exists "insert client metrics" on public.pt_client_metrics;
drop policy if exists "pt admins update client metrics" on public.pt_client_metrics;
drop policy if exists "pt admins delete client metrics" on public.pt_client_metrics;

create policy "read client metrics"
  on public.pt_client_metrics for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_client_metrics.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "insert client metrics"
  on public.pt_client_metrics for insert
  to authenticated
  with check (
    (
      exists (
        select 1 from public.pt_clients c
        where c.id = pt_client_metrics.client_id
        and c.user_id = (select auth.uid())
      )
      and source in ('manual', 'scale')
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update client metrics"
  on public.pt_client_metrics for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete client metrics"
  on public.pt_client_metrics for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

drop policy if exists "pt admins full client goals" on public.pt_client_goals;
drop policy if exists "clients read own active client goals" on public.pt_client_goals;
drop policy if exists "read client goals" on public.pt_client_goals;
drop policy if exists "pt admins insert client goals" on public.pt_client_goals;
drop policy if exists "pt admins update client goals" on public.pt_client_goals;
drop policy if exists "pt admins delete client goals" on public.pt_client_goals;

create policy "read client goals"
  on public.pt_client_goals for select
  to authenticated
  using (
    (
      status = 'active'
      and exists (
        select 1 from public.pt_clients c
        where c.id = pt_client_goals.client_id
        and c.user_id = (select auth.uid())
      )
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert client goals"
  on public.pt_client_goals for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update client goals"
  on public.pt_client_goals for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete client goals"
  on public.pt_client_goals for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

drop policy if exists "pt admins full coaching tasks" on public.pt_coaching_tasks;
drop policy if exists "clients create own coaching tasks" on public.pt_coaching_tasks;
drop policy if exists "pt admins read coaching tasks" on public.pt_coaching_tasks;
drop policy if exists "insert coaching tasks" on public.pt_coaching_tasks;
drop policy if exists "pt admins update coaching tasks" on public.pt_coaching_tasks;
drop policy if exists "pt admins delete coaching tasks" on public.pt_coaching_tasks;

create policy "pt admins read coaching tasks"
  on public.pt_coaching_tasks for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "insert coaching tasks"
  on public.pt_coaching_tasks for insert
  to authenticated
  with check (
    (
      exists (
        select 1 from public.pt_clients c
        where c.id = pt_coaching_tasks.client_id
        and c.user_id = (select auth.uid())
      )
      and source_type in ('weekly_checkin', 'metric_update')
      and status = 'open'
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update coaching tasks"
  on public.pt_coaching_tasks for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete coaching tasks"
  on public.pt_coaching_tasks for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
