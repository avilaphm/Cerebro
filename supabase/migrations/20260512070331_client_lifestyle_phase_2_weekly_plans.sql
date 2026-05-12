-- Client Lifestyle Coaching OS - Phase 2
-- Weekly plan builder, calendar flow, and client-facing plan items.

create table if not exists public.pt_weekly_plans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  coach_summary text,
  client_note text,
  regular_slot text,
  regular_slot_status text not null default 'unconfirmed' check (regular_slot_status in ('unconfirmed', 'confirmed', 'moved', 'cancelled')),
  published_at timestamptz,
  unique (client_id, week_start)
);

create index if not exists pt_weekly_plans_client_week_idx
  on public.pt_weekly_plans (client_id, week_start desc);

create index if not exists pt_weekly_plans_status_week_idx
  on public.pt_weekly_plans (status, week_start desc);

create table if not exists public.pt_weekly_plan_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  plan_id uuid not null references public.pt_weekly_plans(id) on delete cascade,
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  item_type text not null check (item_type in ('pt_session', 'solo_strength', 'run', 'golf_mobility', 'recovery', 'nutrition', 'check_in')),
  scheduled_date date,
  title text not null,
  details text,
  linked_assignment_id uuid references public.pt_program_assignments(id) on delete set null,
  linked_phase_index int,
  linked_day_index int,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped', 'moved')),
  confirmation_status text not null default 'none' check (confirmation_status in ('none', 'needs_confirmation', 'confirmed', 'moved', 'cancelled')),
  sort_order int not null default 0,
  completed_at timestamptz
);

create index if not exists pt_weekly_plan_items_plan_order_idx
  on public.pt_weekly_plan_items (plan_id, scheduled_date, sort_order, created_at);

create index if not exists pt_weekly_plan_items_client_status_idx
  on public.pt_weekly_plan_items (client_id, status, scheduled_date);

alter table public.pt_weekly_plans enable row level security;
alter table public.pt_weekly_plan_items enable row level security;

drop policy if exists "pt admins full weekly plans" on public.pt_weekly_plans;
drop policy if exists "clients read own published weekly plans" on public.pt_weekly_plans;
drop policy if exists "read weekly plans" on public.pt_weekly_plans;
drop policy if exists "pt admins insert weekly plans" on public.pt_weekly_plans;
drop policy if exists "pt admins update weekly plans" on public.pt_weekly_plans;
drop policy if exists "pt admins delete weekly plans" on public.pt_weekly_plans;
drop policy if exists "pt admins full weekly plan items" on public.pt_weekly_plan_items;
drop policy if exists "clients read own weekly plan items" on public.pt_weekly_plan_items;
drop policy if exists "clients update own weekly plan item status" on public.pt_weekly_plan_items;
drop policy if exists "read weekly plan items" on public.pt_weekly_plan_items;
drop policy if exists "pt admins insert weekly plan items" on public.pt_weekly_plan_items;
drop policy if exists "update weekly plan items" on public.pt_weekly_plan_items;
drop policy if exists "pt admins delete weekly plan items" on public.pt_weekly_plan_items;

create policy "read weekly plans"
  on public.pt_weekly_plans for select
  to authenticated
  using (
    (
      status = 'published'
      and exists (
        select 1 from public.pt_clients c
        where c.id = pt_weekly_plans.client_id
        and c.user_id = (select auth.uid())
      )
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert weekly plans"
  on public.pt_weekly_plans for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update weekly plans"
  on public.pt_weekly_plans for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete weekly plans"
  on public.pt_weekly_plans for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "read weekly plan items"
  on public.pt_weekly_plan_items for select
  to authenticated
  using (
    exists (
      select 1
      from public.pt_weekly_plans p
      join public.pt_clients c on c.id = p.client_id
      where p.id = pt_weekly_plan_items.plan_id
      and p.status = 'published'
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert weekly plan items"
  on public.pt_weekly_plan_items for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "update weekly plan items"
  on public.pt_weekly_plan_items for update
  to authenticated
  using (
    exists (
      select 1
      from public.pt_weekly_plans p
      join public.pt_clients c on c.id = p.client_id
      where p.id = pt_weekly_plan_items.plan_id
      and p.status = 'published'
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    (
      status in ('planned', 'done', 'skipped')
      and exists (
        select 1
        from public.pt_weekly_plans p
        join public.pt_clients c on c.id = p.client_id
        where p.id = pt_weekly_plan_items.plan_id
        and p.status = 'published'
        and c.user_id = (select auth.uid())
      )
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete weekly plan items"
  on public.pt_weekly_plan_items for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
