-- PT Client Booking System
-- Client-facing booking, Pedro-controlled availability, session credit ledger,
-- public-safe busy blocks, cancellation requests, and notification tracking.

create table if not exists public.pt_booking_availability (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_duration_minutes int not null default 60 check (slot_duration_minutes between 15 and 240),
  location text,
  label text,
  is_active boolean not null default true,
  check (start_time < end_time)
);

create index if not exists pt_booking_availability_day_idx
  on public.pt_booking_availability (day_of_week, start_time)
  where is_active = true;

create table if not exists public.pt_booking_appointments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Australia/Sydney',
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'cancellation_requested', 'completed', 'cancelled', 'no_show')),
  source text not null default 'client' check (source in ('client', 'coach', 'recurring')),
  recurring_group_id uuid,
  google_calendar_event_id text,
  location text,
  notes text,
  cancel_reason text,
  cancellation_requested_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  check (start_at < end_at)
);

create index if not exists pt_booking_appointments_client_start_idx
  on public.pt_booking_appointments (client_id, start_at desc);

create index if not exists pt_booking_appointments_status_start_idx
  on public.pt_booking_appointments (status, start_at);

create index if not exists pt_booking_appointments_active_range_idx
  on public.pt_booking_appointments (start_at, end_at)
  where status in ('scheduled', 'confirmed', 'cancellation_requested');

create index if not exists pt_booking_appointments_completed_by_idx
  on public.pt_booking_appointments (completed_by);

create index if not exists pt_booking_appointments_created_by_idx
  on public.pt_booking_appointments (created_by);

create table if not exists public.pt_booking_blocks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  appointment_id uuid unique references public.pt_booking_appointments(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  check (start_at < end_at)
);

create index if not exists pt_booking_blocks_range_idx
  on public.pt_booking_blocks (start_at, end_at)
  where status = 'active';

create table if not exists public.pt_session_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  appointment_id uuid references public.pt_booking_appointments(id) on delete set null,
  entry_type text not null check (entry_type in ('pack_added', 'booking_hold', 'hold_released', 'session_completed', 'manual_adjustment')),
  quantity int not null,
  balance_after int,
  notes text,
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists pt_session_ledger_client_created_idx
  on public.pt_session_ledger (client_id, created_at desc);

create index if not exists pt_session_ledger_appointment_idx
  on public.pt_session_ledger (appointment_id);

create index if not exists pt_session_ledger_created_by_idx
  on public.pt_session_ledger (created_by);

create table if not exists public.pt_booking_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  appointment_id uuid not null references public.pt_booking_appointments(id) on delete cascade,
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);

create index if not exists pt_booking_cancellation_requests_status_idx
  on public.pt_booking_cancellation_requests (status, created_at desc);

create index if not exists pt_booking_cancellation_requests_appointment_idx
  on public.pt_booking_cancellation_requests (appointment_id);

create index if not exists pt_booking_cancellation_requests_client_idx
  on public.pt_booking_cancellation_requests (client_id);

create index if not exists pt_booking_cancellation_requests_reviewed_by_idx
  on public.pt_booking_cancellation_requests (reviewed_by);

create table if not exists public.pt_notification_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid references public.pt_clients(id) on delete cascade,
  appointment_id uuid references public.pt_booking_appointments(id) on delete set null,
  notification_type text not null,
  recipient_email text not null,
  subject text not null,
  provider_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pt_notification_log_client_type_idx
  on public.pt_notification_log (client_id, notification_type, created_at desc);

create index if not exists pt_notification_log_appointment_idx
  on public.pt_notification_log (appointment_id);

alter table public.pt_booking_availability enable row level security;
alter table public.pt_booking_appointments enable row level security;
alter table public.pt_booking_blocks enable row level security;
alter table public.pt_session_ledger enable row level security;
alter table public.pt_booking_cancellation_requests enable row level security;
alter table public.pt_notification_log enable row level security;

drop policy if exists "read booking availability" on public.pt_booking_availability;
drop policy if exists "pt admins insert booking availability" on public.pt_booking_availability;
drop policy if exists "pt admins update booking availability" on public.pt_booking_availability;
drop policy if exists "pt admins delete booking availability" on public.pt_booking_availability;
drop policy if exists "read own booking appointments" on public.pt_booking_appointments;
drop policy if exists "pt admins insert booking appointments" on public.pt_booking_appointments;
drop policy if exists "pt admins update booking appointments" on public.pt_booking_appointments;
drop policy if exists "pt admins delete booking appointments" on public.pt_booking_appointments;
drop policy if exists "read booking blocks" on public.pt_booking_blocks;
drop policy if exists "pt admins insert booking blocks" on public.pt_booking_blocks;
drop policy if exists "pt admins update booking blocks" on public.pt_booking_blocks;
drop policy if exists "pt admins delete booking blocks" on public.pt_booking_blocks;
drop policy if exists "read own session ledger" on public.pt_session_ledger;
drop policy if exists "pt admins insert session ledger" on public.pt_session_ledger;
drop policy if exists "read own cancellation requests" on public.pt_booking_cancellation_requests;
drop policy if exists "pt admins update cancellation requests" on public.pt_booking_cancellation_requests;
drop policy if exists "read own notification log" on public.pt_notification_log;
drop policy if exists "pt admins insert notification log" on public.pt_notification_log;

create policy "read booking availability"
  on public.pt_booking_availability for select
  to authenticated
  using (
    is_active = true
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert booking availability"
  on public.pt_booking_availability for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update booking availability"
  on public.pt_booking_availability for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete booking availability"
  on public.pt_booking_availability for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "read own booking appointments"
  on public.pt_booking_appointments for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_booking_appointments.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert booking appointments"
  on public.pt_booking_appointments for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update booking appointments"
  on public.pt_booking_appointments for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete booking appointments"
  on public.pt_booking_appointments for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "read booking blocks"
  on public.pt_booking_blocks for select
  to authenticated
  using (true);

create policy "pt admins insert booking blocks"
  on public.pt_booking_blocks for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update booking blocks"
  on public.pt_booking_blocks for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete booking blocks"
  on public.pt_booking_blocks for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "read own session ledger"
  on public.pt_session_ledger for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_session_ledger.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert session ledger"
  on public.pt_session_ledger for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "read own cancellation requests"
  on public.pt_booking_cancellation_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_booking_cancellation_requests.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update cancellation requests"
  on public.pt_booking_cancellation_requests for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "read own notification log"
  on public.pt_notification_log for select
  to authenticated
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_notification_log.client_id
      and c.user_id = (select auth.uid())
    )
    or lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins insert notification log"
  on public.pt_notification_log for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
