create table if not exists public.social_drafts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  blog_post_id    uuid references public.blog_posts(id) on delete cascade,
  platform        text not null, -- linkedin | twitter
  content         text,
  status          text not null default 'draft' -- draft | posted
);

create index if not exists social_drafts_blog_post_id_idx on public.social_drafts(blog_post_id);

alter table public.social_drafts enable row level security;

create policy "authenticated full access on social drafts"
  on public.social_drafts for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Also allow service role (edge functions) to insert social drafts
create policy "service role full access on social drafts"
  on public.social_drafts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null unique,
  key_name    text not null,
  key_value   text not null,
  updated_at  timestamptz not null default now()
);

alter table public.api_keys enable row level security;

create policy "authenticated full access on api keys"
  on public.api_keys for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
