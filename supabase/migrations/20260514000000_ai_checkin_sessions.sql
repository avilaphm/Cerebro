-- AI weekly check-in sessions: stores per-client conversational check-in history
create table pt_checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references pt_clients(id) on delete cascade,
  week_start date not null,
  status text not null default 'in_progress',
  messages jsonb not null default '[]'::jsonb,
  activity_selections jsonb,
  pt_session_suggestions jsonb,
  ai_weekly_focus jsonb,
  injury_tips text,
  stress_tips text,
  nutrition_tips text,
  completed_at timestamptz,
  constraint pt_checkin_sessions_status_check check (status in ('in_progress', 'completed')),
  constraint pt_checkin_sessions_client_week_unique unique (client_id, week_start)
);

create index pt_checkin_sessions_client_week_idx
  on pt_checkin_sessions (client_id, week_start desc);

alter table pt_checkin_sessions enable row level security;

create policy "clients_select_own_checkin_sessions"
  on pt_checkin_sessions for select
  using (
    client_id in (
      select id from pt_clients where user_id = auth.uid()
    )
  );

create policy "clients_insert_own_checkin_sessions"
  on pt_checkin_sessions for insert
  with check (
    client_id in (
      select id from pt_clients where user_id = auth.uid()
    )
  );

create policy "admins_all_checkin_sessions"
  on pt_checkin_sessions for all
  using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'admin'
    )
  );

-- Extend pt_weekly_checkins to link to AI sessions and track mode
alter table pt_weekly_checkins
  add column if not exists checkin_session_id uuid references pt_checkin_sessions(id),
  add column if not exists checkin_mode text not null default 'form';

alter table pt_weekly_checkins
  add constraint pt_weekly_checkins_mode_check check (checkin_mode in ('form', 'ai'));
