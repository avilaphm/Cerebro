-- Weekly Tonnage Phase 2: cached weekly aggregates for client and coach views.

create table if not exists public.weekly_tonnage (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  week_start date not null,
  timezone text not null default 'Australia/Sydney',
  range_start timestamptz not null,
  range_end timestamptz not null,
  total_kg numeric not null default 0,
  by_pattern jsonb not null default '{}'::jsonb,
  by_plane jsonb not null default '{}'::jsonb,
  by_muscle jsonb not null default '{}'::jsonb,
  excluded jsonb not null default '[]'::jsonb,
  bodyweight_missing boolean not null default false,
  workout_count integer not null default 0,
  set_count integer not null default 0,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, week_start)
);

create index if not exists weekly_tonnage_client_week_idx
  on public.weekly_tonnage (client_id, week_start desc);

alter table public.weekly_tonnage enable row level security;

grant select on public.weekly_tonnage to authenticated;
grant select, insert, update, delete on public.weekly_tonnage to service_role;

drop policy if exists "service role full weekly tonnage" on public.weekly_tonnage;
create policy "service role full weekly tonnage"
  on public.weekly_tonnage for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "pt admins full weekly tonnage" on public.weekly_tonnage;
create policy "pt admins full weekly tonnage"
  on public.weekly_tonnage for all
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

drop policy if exists "clients read own weekly tonnage" on public.weekly_tonnage;
create policy "clients read own weekly tonnage"
  on public.weekly_tonnage for select
  to authenticated
  using (
    exists (
      select 1
      from public.pt_clients c
      where c.id = weekly_tonnage.client_id
      and c.user_id = (select auth.uid())
    )
  );
