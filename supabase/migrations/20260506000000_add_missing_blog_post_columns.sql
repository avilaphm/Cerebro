alter table public.blog_posts
  add column if not exists research_context text,
  add column if not exists header_image_url text,
  add column if not exists scheduled_at timestamptz;
