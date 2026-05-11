-- PT Dashboard: Pedro's programming second brain.
-- V1 keeps programme structure in jsonb for flexible editing, while logs and
-- events are normalized so progress and weekly summaries are easy to query.

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email      text not null,
  full_name  text,
  role       text not null default 'client' check (role in ('admin', 'client'))
);

create unique index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.pt_clients (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  email      text not null,
  status     text not null default 'invited' check (status in ('invited', 'active', 'paused', 'archived')),
  goals      text,
  notes      text
);

create unique index if not exists pt_clients_email_idx on public.pt_clients (lower(email));
create index if not exists pt_clients_user_id_idx on public.pt_clients (user_id);
create index if not exists pt_clients_status_idx on public.pt_clients (status);

create table if not exists public.pt_exercises (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text not null,
  muscles     text[] not null default '{}',
  purpose     text,
  equipment   text,
  video_url   text,
  cues        text[] not null default '{}',
  tags        text[] not null default '{}',
  source      text not null default 'manual' check (source in ('manual', 'spreadsheet', 'ai'))
);

create unique index if not exists pt_exercises_name_idx on public.pt_exercises (lower(name));
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pt_exercises_name_key'
  ) then
    alter table public.pt_exercises add constraint pt_exercises_name_key unique (name);
  end if;
end$$;
create index if not exists pt_exercises_muscles_idx on public.pt_exercises using gin (muscles);
create index if not exists pt_exercises_tags_idx on public.pt_exercises using gin (tags);

create table if not exists public.pt_program_templates (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  name           text not null,
  description    text,
  goal           text,
  duration_weeks int not null default 0,
  phase_count    int not null default 0,
  status         text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  programme      jsonb not null default '{"phases":[]}'::jsonb
);

create index if not exists pt_program_templates_status_idx on public.pt_program_templates (status);
create index if not exists pt_program_templates_created_idx on public.pt_program_templates (created_at desc);

create table if not exists public.pt_program_assignments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  client_id      uuid not null references public.pt_clients(id) on delete cascade,
  template_id    uuid references public.pt_program_templates(id) on delete set null,
  name           text not null,
  goal           text,
  duration_weeks int not null default 0,
  phase_count    int not null default 0,
  start_date     date,
  status         text not null default 'active' check (status in ('draft', 'active', 'completed', 'paused', 'archived')),
  programme      jsonb not null default '{"phases":[]}'::jsonb
);

create index if not exists pt_program_assignments_client_idx on public.pt_program_assignments (client_id);
create index if not exists pt_program_assignments_template_idx on public.pt_program_assignments (template_id);
create index if not exists pt_program_assignments_status_idx on public.pt_program_assignments (status);

create table if not exists public.pt_workout_logs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz not null default now(),
  client_id      uuid not null references public.pt_clients(id) on delete cascade,
  assignment_id  uuid not null references public.pt_program_assignments(id) on delete cascade,
  phase_index    int not null default 0,
  week_number    int not null default 1,
  day_index      int not null default 0,
  workout_title  text not null,
  notes          text
);

create index if not exists pt_workout_logs_client_completed_idx on public.pt_workout_logs (client_id, completed_at desc);
create index if not exists pt_workout_logs_assignment_idx on public.pt_workout_logs (assignment_id);

create table if not exists public.pt_set_logs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  workout_log_id uuid not null references public.pt_workout_logs(id) on delete cascade,
  client_id      uuid not null references public.pt_clients(id) on delete cascade,
  assignment_id  uuid not null references public.pt_program_assignments(id) on delete cascade,
  exercise_id    uuid references public.pt_exercises(id) on delete set null,
  exercise_name  text not null,
  set_number     int not null,
  reps           numeric,
  weight         numeric,
  notes          text
);

create index if not exists pt_set_logs_client_exercise_idx on public.pt_set_logs (client_id, exercise_id, created_at desc);
create index if not exists pt_set_logs_workout_idx on public.pt_set_logs (workout_log_id);

create table if not exists public.pt_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  client_id     uuid not null references public.pt_clients(id) on delete cascade,
  assignment_id uuid references public.pt_program_assignments(id) on delete cascade,
  event_type    text not null,
  metadata      jsonb not null default '{}'::jsonb
);

create index if not exists pt_events_client_created_idx on public.pt_events (client_id, created_at desc);
create index if not exists pt_events_type_idx on public.pt_events (event_type);

-- RLS helpers are intentionally inline in policies rather than security
-- definer functions in public. Pedro's known emails bootstrap admin access.

alter table public.profiles enable row level security;
alter table public.pt_clients enable row level security;
alter table public.pt_exercises enable row level security;
alter table public.pt_program_templates enable row level security;
alter table public.pt_program_assignments enable row level security;
alter table public.pt_workout_logs enable row level security;
alter table public.pt_set_logs enable row level security;
alter table public.pt_events enable row level security;

-- Profiles -------------------------------------------------------------------

create policy "service role full on profiles"
  on public.profiles for all
  to service_role
  using (true)
  with check (true);

create policy "users read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "users create own client profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id and role = 'client');

create policy "users update own profile basics"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id and role = (select role from public.profiles where id = (select auth.uid())));

-- Admin policies --------------------------------------------------------------

create policy "pt admins full clients"
  on public.pt_clients for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins full exercises"
  on public.pt_exercises for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins full templates"
  on public.pt_program_templates for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins full assignments"
  on public.pt_program_assignments for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins full workout logs"
  on public.pt_workout_logs for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins full set logs"
  on public.pt_set_logs for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins full events"
  on public.pt_events for all
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

-- Client policies -------------------------------------------------------------

create policy "clients read own client row"
  on public.pt_clients for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "clients read assigned programmes"
  on public.pt_program_assignments for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_program_assignments.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "clients read assigned exercises"
  on public.pt_exercises for select
  to authenticated
  using (
    exists (
      select 1
      from public.pt_program_assignments a
      join public.pt_clients c on c.id = a.client_id
      where c.user_id = (select auth.uid())
      and a.programme::text ilike '%' || pt_exercises.id::text || '%'
    )
  );

create policy "clients read own workout logs"
  on public.pt_workout_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_workout_logs.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "clients insert own workout logs"
  on public.pt_workout_logs for insert
  to authenticated
  with check (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_workout_logs.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "clients read own set logs"
  on public.pt_set_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_set_logs.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "clients insert own set logs"
  on public.pt_set_logs for insert
  to authenticated
  with check (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_set_logs.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "clients insert own events"
  on public.pt_events for insert
  to authenticated
  with check (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_events.client_id
      and c.user_id = (select auth.uid())
    )
  );

create policy "clients read own events"
  on public.pt_events for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_events.client_id
      and c.user_id = (select auth.uid())
    )
  );
