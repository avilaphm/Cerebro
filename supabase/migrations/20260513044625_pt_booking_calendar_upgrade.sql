-- PT booking calendar upgrade: separate 45 minute session duration from
-- the 5 minute operational buffer that blocks the next client slot.

alter table public.pt_booking_availability
  add column if not exists session_duration_minutes int not null default 45
    check (session_duration_minutes between 15 and 240),
  add column if not exists buffer_minutes int not null default 5
    check (buffer_minutes between 0 and 60);

update public.pt_booking_availability
set
  session_duration_minutes = 45,
  buffer_minutes = 5,
  slot_duration_minutes = 50
where session_duration_minutes <> 45
  or buffer_minutes <> 5
  or slot_duration_minutes <> 50;

create index if not exists pt_booking_notification_week_idx
  on public.pt_notification_log ((metadata ->> 'week_start'), notification_type, client_id)
  where notification_type = 'weekly_booking_reminder';

create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'pt-booking-weekly-reminders',
  '0 22 * * 4',
  $$
    select net.http_post(
      url := 'https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/manage-pt-booking',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer cerebro-cron-2026"}'::jsonb,
      body := '{"action":"send_weekly_reminders"}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);
