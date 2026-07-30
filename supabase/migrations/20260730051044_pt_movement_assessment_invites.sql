create table if not exists public.pt_movement_assessment_invites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  appointment_id uuid references public.pt_booking_appointments(id) on delete set null,
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'revoked')),
  expires_at timestamptz not null,
  sent_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pt_movement_assessment_invites_client_idx
  on public.pt_movement_assessment_invites (client_id, created_at desc);

create index if not exists pt_movement_assessment_invites_pending_idx
  on public.pt_movement_assessment_invites (expires_at)
  where status = 'pending';

alter table public.pt_movement_assessment_invites enable row level security;

create policy "Admins manage movement assessment invites"
  on public.pt_movement_assessment_invites
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

comment on table public.pt_movement_assessment_invites is
  'One-time PAR-Q links created by a coach, optionally connected to an existing movement assessment appointment.';
