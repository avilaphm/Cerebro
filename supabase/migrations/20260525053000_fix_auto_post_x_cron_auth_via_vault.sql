-- The auto-post-scheduled-x cron was sending a stale hardcoded bearer
-- (`cerebro-cron-2026`) that no longer matched the edge function secret, so every
-- run 401'd. Re-point it at a dedicated secret stored in Supabase Vault
-- (`cerebro_cron_secret`), which post-to-x now also accepts via CEREBRO_CRON_SECRET.
-- The secret value lives only in Vault + the function env, never in this repo.
select cron.unschedule('auto-post-scheduled-x');

select cron.schedule(
  'auto-post-scheduled-x',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/post-to-x',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cerebro_cron_secret')
      ),
      body    := '{"process_scheduled": true}'::jsonb
    );
  $$
);
