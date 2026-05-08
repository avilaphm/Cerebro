-- Track public page visits to attribute traffic to social channels.
-- Inserts come from the server route using the service role; reads from the
-- dashboard use the authenticated role.

create table if not exists public.page_visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path text not null,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  user_agent text,
  session_id text,
  source text  -- normalized: instagram, x, youtube, tiktok, search, direct, other
);

create index if not exists page_visits_created_idx on public.page_visits (created_at desc);
create index if not exists page_visits_source_idx on public.page_visits (source);

alter table public.page_visits enable row level security;

create policy "authenticated read page_visits"
  on public.page_visits for select
  using (auth.role() = 'authenticated');
