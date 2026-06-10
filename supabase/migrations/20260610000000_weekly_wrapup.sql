-- Weekly wrap-up email feature
-- 1) per-client/per-week computed wrap-up store
-- 2) client opt-out preference column
-- 3) Sunday-morning cron that triggers the send-weekly-wrapup edge function

-- ── 1. Wrap-up store ────────────────────────────────────────────────────────
create table if not exists public.pt_client_weekly_wrapup (
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  metrics jsonb not null default '{}'::jsonb,
  recap jsonb not null default '{}'::jsonb,
  had_activity boolean not null default false,
  generated_at timestamptz not null default now(),
  primary key (client_id, week_start)
);

alter table public.pt_client_weekly_wrapup enable row level security;

create policy "service role full weekly wrapup"
  on public.pt_client_weekly_wrapup for all
  using (true) with check (true);

create policy "pt admins full weekly wrapup"
  on public.pt_client_weekly_wrapup for all
  using (
    lower((select auth.jwt() ->> 'email')) = any (array[
      'pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'
    ])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read own weekly wrapup"
  on public.pt_client_weekly_wrapup for select
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_client_weekly_wrapup.client_id and c.user_id = (select auth.uid())
    )
  );

-- ── 2. Client opt-out preference (on by default) ────────────────────────────
alter table public.pt_clients
  add column if not exists receive_weekly_wrap_up_email boolean not null default true;

-- ── 3. Sunday-morning send cron ─────────────────────────────────────────────
-- 0 22 * * 6  = Saturday 22:00 UTC = Sunday ~08:00 AEST / ~09:00 AEDT (Sydney).
-- Idempotent: drop any prior job of the same name before (re)scheduling.
do $$
begin
  perform cron.unschedule('pt-weekly-wrapup')
  where exists (select 1 from cron.job where jobname = 'pt-weekly-wrapup');
end $$;

select cron.schedule(
  'pt-weekly-wrapup',
  '0 22 * * 6',
  $$
    select net.http_post(
      url := 'https://otcnrkfvgyvwolironoz.supabase.co/functions/v1/send-weekly-wrapup',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer cerebro-cron-2026"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
  $$
);
