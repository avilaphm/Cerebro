-- Leads table
create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text,
  email       text,
  message     text,
  industry    text,
  pain_point  text,
  current_tools text,
  team_size   text,
  budget      text,
  timeline    text,
  source      text,
  status      text default 'new'
);

-- Conversations table
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  lead_id     uuid references public.leads(id) on delete cascade,
  messages    jsonb not null default '[]'
);

-- Lead scopes table (internal, AI-generated draft for Pedro's use)
create table public.lead_scopes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  lead_id     uuid references public.leads(id) on delete cascade,
  scope_draft text
);

-- RLS: edge function uses service role key, which bypasses RLS entirely.
-- These policies deny all access from anon/authenticated roles as a safety net.
alter table public.leads enable row level security;
alter table public.conversations enable row level security;
alter table public.lead_scopes enable row level security;

create policy "service role only on leads"
  on public.leads for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role only on conversations"
  on public.conversations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role only on lead_scopes"
  on public.lead_scopes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
