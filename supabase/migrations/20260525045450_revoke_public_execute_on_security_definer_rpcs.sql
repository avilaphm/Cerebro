-- Revoke explicit anon/authenticated EXECUTE on SECURITY DEFINER RPCs that bypass RLS.
-- match_client_brain_chunks: returns any client's private brain by target_client_id;
--   nothing calls it via anon/authenticated (service_role retains EXECUTE for future use).
-- delete_stale_program_drafts: destructive; only the pg_cron job (postgres owner) runs it.
-- NOTE: this alone is insufficient because of the default PUBLIC grant — see the
-- follow-up migration revoke_public_role_execute_on_security_definer_rpcs.
revoke execute on function public.match_client_brain_chunks(extensions.vector, uuid, integer, double precision) from anon, authenticated;
revoke execute on function public.delete_stale_program_drafts() from anon, authenticated;
