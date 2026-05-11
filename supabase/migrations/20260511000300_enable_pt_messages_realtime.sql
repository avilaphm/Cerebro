-- Ensure PT chat messages are streamed to Supabase Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'pt_messages'
    )
  then
    alter publication supabase_realtime add table public.pt_messages;
  end if;
end $$;

alter table public.pt_messages replica identity full;
