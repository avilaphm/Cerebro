-- RLS: let Pedro (authenticated) read and update leads + proposals from the dashboard.
-- Edge functions use the service role key and bypass RLS automatically.

create policy "authenticated read leads"
  on public.leads for select
  using (auth.role() = 'authenticated');

create policy "authenticated update leads"
  on public.leads for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "authenticated read proposals"
  on public.proposals for select
  using (auth.role() = 'authenticated');

-- Journey tracking fields on leads
alter table public.leads
  add column if not exists email_opened  boolean not null default false,
  add column if not exists call_booked   boolean not null default false,
  add column if not exists became_client boolean; -- null = undecided, true = client, false = lost

-- Extracted deliverables array stored alongside each proposal
alter table public.proposals
  add column if not exists deliverables jsonb; -- e.g. ["Lead capture flow", "Onboarding automation"]
