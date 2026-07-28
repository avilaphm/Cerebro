create table if not exists public.blog_research_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  seed_topic text,
  notes text,
  sector text not null default 'construction, engineering and advisory',
  status text not null default 'researching'
    check (status in ('researching', 'ready', 'generating', 'drafted', 'failed')),
  findings jsonb not null default '[]'::jsonb,
  audience_language jsonb not null default '[]'::jsonb,
  angles jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  selected_angle_index integer,
  error text
);

create index if not exists blog_research_runs_created_by_created_at_idx
  on public.blog_research_runs (created_by, created_at desc);

create index if not exists blog_research_runs_status_idx
  on public.blog_research_runs (status);

alter table public.blog_research_runs enable row level security;

revoke all on table public.blog_research_runs from anon;
grant select, insert, update, delete on table public.blog_research_runs to authenticated;

create policy "users read their blog research"
  on public.blog_research_runs
  for select
  to authenticated
  using ((select auth.uid()) = created_by);

create policy "users create their blog research"
  on public.blog_research_runs
  for insert
  to authenticated
  with check ((select auth.uid()) = created_by);

create policy "users update their blog research"
  on public.blog_research_runs
  for update
  to authenticated
  using ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);

create policy "users delete their blog research"
  on public.blog_research_runs
  for delete
  to authenticated
  using ((select auth.uid()) = created_by);

alter table public.blog_posts
  add column if not exists research_run_id uuid
    references public.blog_research_runs(id) on delete set null,
  add column if not exists qc_report jsonb not null default '{}'::jsonb;

create index if not exists blog_posts_research_run_id_idx
  on public.blog_posts (research_run_id)
  where research_run_id is not null;
