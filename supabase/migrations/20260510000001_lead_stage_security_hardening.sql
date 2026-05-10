-- Pin function search_path (linter 0011) and force lead_stages view to run
-- under the querying user's permissions so lead_tags RLS applies (linter 0010).

alter function public.lead_stage(uuid) set search_path = public, pg_temp;

alter view public.lead_stages set (security_invoker = on);
