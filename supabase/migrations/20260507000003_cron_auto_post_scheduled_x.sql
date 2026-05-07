-- Cron job: auto-post scheduled X drafts every 5 minutes.
-- Requires pg_net and pg_cron (both available on Supabase free tier).
-- The Bearer token must match the CEREBRO_INTERNAL_SECRET edge function secret.

create extension if not exists pg_net;

select cron.schedule(
  'auto-post-scheduled-x',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/post-to-x',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer cerebro-cron-2026"}'::jsonb,
      body    := '{"process_scheduled": true}'::jsonb
    );
  $$
);
