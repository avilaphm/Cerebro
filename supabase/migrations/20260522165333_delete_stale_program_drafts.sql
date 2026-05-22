-- Auto-delete abandoned programme generation drafts after 24h.
-- A run is a "saved" programme if an assignment or template references it; those are
-- preserved. Everything else (unsaved drafts, old failed/running runs) older than 24h
-- is removed. Child rows cascade (steps, retrieval logs, review outputs); links from
-- assignments/templates/1rm tests are SET NULL by their FK rules, so no real programme
-- is ever destroyed.
create or replace function public.delete_stale_program_drafts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  with doomed as (
    delete from pt_program_generation_runs r
    where r.created_at < now() - interval '24 hours'
      and not exists (select 1 from pt_program_assignments a where a.generation_run_id = r.id)
      and not exists (select 1 from pt_program_templates t where t.generation_run_id = r.id)
    returning 1
  )
  select count(*) into deleted_count from doomed;
  return deleted_count;
end;
$$;

-- Schedule it hourly (idempotent: drop any prior job with this name first).
select cron.unschedule('delete-stale-program-drafts')
where exists (select 1 from cron.job where jobname = 'delete-stale-program-drafts');

select cron.schedule(
  'delete-stale-program-drafts',
  '0 * * * *',
  $$select public.delete_stale_program_drafts();$$
);
