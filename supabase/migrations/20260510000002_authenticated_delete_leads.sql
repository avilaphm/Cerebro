-- Allow Pedro (authenticated) to delete a lead from the dashboard.
-- Cascades wipe lead_tags, conversations, lead_scopes, proposals via FK ON DELETE CASCADE.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'leads' and policyname = 'authenticated delete leads'
  ) then
    create policy "authenticated delete leads"
      on public.leads for delete
      using (auth.role() = 'authenticated');
  end if;
end$$;
