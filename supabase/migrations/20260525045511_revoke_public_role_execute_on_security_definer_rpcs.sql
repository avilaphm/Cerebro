-- Postgres grants EXECUTE to PUBLIC by default, so the prior revoke from
-- anon/authenticated was not enough — those roles still inherited EXECUTE via PUBLIC.
-- Revoke from PUBLIC so only postgres + service_role retain EXECUTE on these
-- SECURITY DEFINER (RLS-bypassing) functions.
revoke execute on function public.match_client_brain_chunks(extensions.vector, uuid, integer, double precision) from public;
revoke execute on function public.delete_stale_program_drafts() from public;
