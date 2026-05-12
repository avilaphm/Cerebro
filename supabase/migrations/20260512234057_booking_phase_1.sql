-- Booking System - Phase 1
-- Internal booking cockpit: settings, availability windows, and appointments.

create table if not exists public.booking_settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_user_id uuid references auth.users(id) on delete set null,
  public_slug text unique,
  timezone text not null default 'Australia/Sydney',
  call_duration_minutes int not null default 30 check (call_duration_minutes between 15 and 180),
  buffer_minutes int not null default 15 check (buffer_minutes between 0 and 120),
  booking_horizon_days int not null default 21 check (booking_horizon_days between 1 and 120),
  minimum_notice_hours int not null default 12 check (minimum_notice_hours between 0 and 336),
  location_type text not null default 'video' check (location_type in ('video', 'phone', 'in_person')),
  location_details text,
  confirmation_message text
);

create index if not exists booking_settings_owner_idx
  on public.booking_settings (owner_user_id);

create table if not exists public.booking_availability_windows (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settings_id uuid not null references public.booking_settings(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  label text,
  check (start_time < end_time)
);

create index if not exists booking_availability_windows_settings_day_idx
  on public.booking_availability_windows (settings_id, day_of_week, start_time);

create table if not exists public.booking_appointments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settings_id uuid references public.booking_settings(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Australia/Sydney',
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  source text not null default 'manual' check (source in ('manual', 'public', 'lead_link', 'import')),
  invitee_name text not null,
  invitee_email text not null,
  invitee_phone text,
  business_name text,
  notes text,
  cancel_reason text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique_token text unique,
  check (start_at < end_at)
);

create index if not exists booking_appointments_start_idx
  on public.booking_appointments (start_at);

create index if not exists booking_appointments_status_start_idx
  on public.booking_appointments (status, start_at);

create index if not exists booking_appointments_lead_idx
  on public.booking_appointments (lead_id);

alter table public.booking_settings enable row level security;
alter table public.booking_availability_windows enable row level security;
alter table public.booking_appointments enable row level security;

drop policy if exists "booking settings read admin" on public.booking_settings;
drop policy if exists "booking settings insert admin" on public.booking_settings;
drop policy if exists "booking settings update admin" on public.booking_settings;
drop policy if exists "booking settings delete admin" on public.booking_settings;
drop policy if exists "booking availability read admin" on public.booking_availability_windows;
drop policy if exists "booking availability insert admin" on public.booking_availability_windows;
drop policy if exists "booking availability update admin" on public.booking_availability_windows;
drop policy if exists "booking availability delete admin" on public.booking_availability_windows;
drop policy if exists "booking appointments read admin" on public.booking_appointments;
drop policy if exists "booking appointments insert admin" on public.booking_appointments;
drop policy if exists "booking appointments update admin" on public.booking_appointments;
drop policy if exists "booking appointments delete admin" on public.booking_appointments;

create policy "booking settings read admin"
  on public.booking_settings for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking settings insert admin"
  on public.booking_settings for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking settings update admin"
  on public.booking_settings for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking settings delete admin"
  on public.booking_settings for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking availability read admin"
  on public.booking_availability_windows for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking availability insert admin"
  on public.booking_availability_windows for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking availability update admin"
  on public.booking_availability_windows for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking availability delete admin"
  on public.booking_availability_windows for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking appointments read admin"
  on public.booking_appointments for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking appointments insert admin"
  on public.booking_appointments for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking appointments update admin"
  on public.booking_appointments for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "booking appointments delete admin"
  on public.booking_appointments for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
