-- Client Lifestyle Coaching OS - Phase 3
-- Progress tracking, adherence reviews, and monthly client summaries.

alter table public.pt_client_metrics
  add column if not exists photo_urls text[] not null default '{}'::text[];

create table if not exists public.pt_coaching_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  review_type text not null check (review_type in ('weekly', 'monthly')),
  status text not null default 'draft' check (status in ('draft', 'final', 'archived')),
  period_start date not null,
  period_end date not null,
  total_items int not null default 0,
  completed_items int not null default 0,
  skipped_items int not null default 0,
  adherence_pct numeric,
  metrics_summary text,
  performance_summary text,
  client_feedback text,
  what_got_done text,
  what_was_missed text,
  suggested_changes text,
  pedro_summary text,
  client_summary text,
  body_snapshot jsonb not null default '{}'::jsonb,
  performance_snapshot jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  unique (client_id, review_type, period_start)
);

create index if not exists pt_coaching_reviews_client_type_period_idx
  on public.pt_coaching_reviews (client_id, review_type, period_start desc);

create index if not exists pt_coaching_reviews_status_idx
  on public.pt_coaching_reviews (status, review_type, period_start desc);

alter table public.pt_coaching_reviews enable row level security;

drop policy if exists "pt admins read coaching reviews" on public.pt_coaching_reviews;
drop policy if exists "clients read own monthly coaching reviews" on public.pt_coaching_reviews;
drop policy if exists "pt admins insert coaching reviews" on public.pt_coaching_reviews;
drop policy if exists "pt admins update coaching reviews" on public.pt_coaching_reviews;
drop policy if exists "pt admins delete coaching reviews" on public.pt_coaching_reviews;

create policy "pt admins read coaching reviews"
  on public.pt_coaching_reviews for select
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    or (
      review_type = 'monthly'
      and status = 'final'
      and exists (
        select 1 from public.pt_clients c
        where c.id = pt_coaching_reviews.client_id
        and c.user_id = (select auth.uid())
      )
    )
  );

create policy "pt admins insert coaching reviews"
  on public.pt_coaching_reviews for insert
  to authenticated
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins update coaching reviews"
  on public.pt_coaching_reviews for update
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  with check (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "pt admins delete coaching reviews"
  on public.pt_coaching_reviews for delete
  to authenticated
  using (
    lower((select auth.jwt()) ->> 'email') in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );
