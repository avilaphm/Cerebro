create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  title            text not null,
  slug             text not null unique,
  topic            text,
  notes            text,
  content_md       text,
  content_html     text,
  meta_description text,
  author           text not null default 'Pedro Avila',
  status           text not null default 'published'
);

create index if not exists blog_posts_slug_idx on public.blog_posts(slug);
create index if not exists blog_posts_status_idx on public.blog_posts(status);

alter table public.blog_posts enable row level security;

-- Public can read published posts
create policy "public read published blog posts"
  on public.blog_posts for select
  using (status = 'published');

-- Only authenticated users (Pedro) can insert/update/delete
create policy "authenticated full access on blog posts"
  on public.blog_posts for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
