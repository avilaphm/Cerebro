-- Cron job: auto-post scheduled X drafts every 5 minutes
-- Requires pg_net (enabled by default on Supabase) and pg_cron.
--
-- Before running this migration, set the internal secret once in the SQL editor:
--   ALTER DATABASE postgres SET app.cerebro_internal_secret = 'your-secret-value';
-- Use the same value for the CEREBRO_INTERNAL_SECRET edge function secret.

create extension if not exists pg_net;

select cron.schedule(
  'auto-post-scheduled-x',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/post-to-x',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.cerebro_internal_secret', true), '')
      ),
      body    := '{"process_scheduled": true}'::jsonb
    );
  $$
);
