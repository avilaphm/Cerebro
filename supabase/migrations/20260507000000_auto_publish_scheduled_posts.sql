-- Enable pg_cron extension (may already be enabled in Supabase)
create extension if not exists pg_cron;

-- Grant usage to postgres role
grant usage on schema cron to postgres;

-- Schedule auto-publish: every 5 minutes, publish posts whose scheduled time has passed
select cron.schedule(
  'auto-publish-scheduled-posts',
  '*/5 * * * *',
  $$
    UPDATE public.blog_posts
    SET
      status       = 'published',
      published_at = scheduled_at
    WHERE
      status       = 'scheduled'
      AND scheduled_at <= now();
  $$
);
